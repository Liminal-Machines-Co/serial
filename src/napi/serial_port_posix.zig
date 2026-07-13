//! Native `NativeSerialPort` class backing src/SerialPort.ts.
//!
//! Contract (see src/types.ts INativeSerialPort):
//!   open(path, baudRate, cb(err, data: Buffer))  - start background reads
//!   write(data: Buffer): Promise<void>
//!   drain(): Promise<void>
//!   close(): void
//!
//! Reads run on a dedicated OS thread and are delivered to `cb` via an N-API
//! threadsafe function. write/drain run on the libuv threadpool via async work
//! and resolve a Promise. POSIX only for now; Windows is a follow-up.
const std = @import("std");
const builtin = @import("builtin");
const c = @import("c");
const serial = @import("serial");

const alloc = std.heap.c_allocator;

// libc pieces not exposed as `pub` by std.c.
extern "c" fn read(fd: std.c.fd_t, buf: [*]u8, nbyte: usize) isize;
extern "c" fn write(fd: std.c.fd_t, buf: [*]const u8, nbyte: usize) isize;
extern "c" fn close(fd: std.c.fd_t) c_int;
extern "c" fn pipe(fds: *[2]std.c.fd_t) c_int;
extern "c" fn poll(fds: [*]std.c.pollfd, nfds: std.c.nfds_t, timeout: c_int) c_int;
extern "c" fn tcdrain(fd: std.c.fd_t) c_int;

const Port = struct {
    fd: std.c.fd_t = -1,
    is_open: bool = false,
    tsfn: c.napi_threadsafe_function = null,
    thread: ?std.Thread = null,
    stop: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    // self-pipe used to interrupt the blocking poll() on close.
    wake_r: std.c.fd_t = -1,
    wake_w: std.c.fd_t = -1,
};

/// Heap payload handed from the read thread to the JS callback via the TSFN.
const Chunk = struct {
    bytes: []u8,
};

const WorkKind = enum { write, drain };

/// State for a queued async write/drain operation.
const Work = struct {
    kind: WorkKind,
    fd: std.c.fd_t,
    data: []u8, // owned copy of bytes to write (empty for drain)
    ok: bool = false,
    err_no: c_int = 0,
    deferred: c.napi_deferred,
    work: c.napi_async_work = null,
};

// ---------------------------------------------------------------------------
// Class definition
// ---------------------------------------------------------------------------

pub fn defineClass(env: c.napi_env) c.napi_value {
    const props = [_]c.napi_property_descriptor{
        method("open", jsOpen),
        method("write", jsWrite),
        method("drain", jsDrain),
        method("close", jsClose),
    };
    var class: c.napi_value = undefined;
    _ = c.napi_define_class(
        env,
        "NativeSerialPort",
        c.NAPI_AUTO_LENGTH,
        construct,
        null,
        props.len,
        &props,
        &class,
    );
    return class;
}

fn method(comptime name: [:0]const u8, cb: c.napi_callback) c.napi_property_descriptor {
    return .{
        .utf8name = name.ptr,
        .name = null,
        .method = cb,
        .getter = null,
        .setter = null,
        .value = null,
        .attributes = c.napi_default,
        .data = null,
    };
}

fn construct(env: c.napi_env, info: c.napi_callback_info) callconv(.c) c.napi_value {
    const this = cbThis(env, info, 0, null) catch return getUndefined(env);
    const port = alloc.create(Port) catch {
        _ = c.napi_throw_error(env, null, "out of memory");
        return getUndefined(env);
    };
    port.* = .{};
    _ = c.napi_wrap(env, this, port, finalize, null, null);
    return this;
}

fn finalize(_: c.napi_env, data: ?*anyopaque, _: ?*anyopaque) callconv(.c) void {
    const port: *Port = @ptrCast(@alignCast(data orelse return));
    shutdown(port);
    alloc.destroy(port);
}

// ---------------------------------------------------------------------------
// open(path, baudRate, cb)
// ---------------------------------------------------------------------------

fn jsOpen(env: c.napi_env, info: c.napi_callback_info) callconv(.c) c.napi_value {
    var argv: [3]c.napi_value = undefined;
    const this = cbThis(env, info, 3, &argv) catch return getUndefined(env);
    const port = unwrap(env, this) orelse return getUndefined(env);

    if (port.is_open) {
        _ = c.napi_throw_error(env, null, "Port is already open");
        return getUndefined(env);
    }

    // path
    var path_buf: [std.fs.max_path_bytes]u8 = undefined;
    var path_len: usize = 0;
    if (c.napi_get_value_string_utf8(env, argv[0], &path_buf, path_buf.len, &path_len) != c.napi_ok) {
        _ = c.napi_throw_error(env, null, "invalid path");
        return getUndefined(env);
    }
    path_buf[path_len] = 0;
    const path_z: [*:0]const u8 = @ptrCast(&path_buf);

    // baudRate
    var baud: u32 = 0;
    _ = c.napi_get_value_uint32(env, argv[1], &baud);

    // open device
    const oflag = std.c.O{ .ACCMODE = .RDWR, .NOCTTY = true };
    const fd = std.c.open(path_z, oflag, @as(std.c.mode_t, 0));
    if (fd < 0) {
        _ = c.napi_throw_error(env, null, "failed to open serial port");
        return getUndefined(env);
    }
    errdefer _ = close(fd);

    // configure line settings unless baudRate == 0 (PTY/skip sentinel)
    if (baud != 0) {
        const file = std.Io.File{ .handle = fd, .flags = .{ .nonblocking = false } };
        serial.configureSerialPort(file, .{ .baud_rate = baud }) catch {
            _ = close(fd);
            _ = c.napi_throw_error(env, null, "failed to configure serial port");
            return getUndefined(env);
        };
    }

    // self-pipe to wake the read thread on close
    var wake: [2]std.c.fd_t = undefined;
    if (pipe(&wake) != 0) {
        _ = close(fd);
        _ = c.napi_throw_error(env, null, "failed to create wake pipe");
        return getUndefined(env);
    }

    // threadsafe function wrapping the JS callback
    var res_name: c.napi_value = undefined;
    _ = c.napi_create_string_utf8(env, "tinySerialRead", c.NAPI_AUTO_LENGTH, &res_name);
    var tsfn: c.napi_threadsafe_function = null;
    if (c.napi_create_threadsafe_function(
        env,
        argv[2], // JS callback
        null,
        res_name,
        0, // max_queue_size: unlimited
        1, // initial_thread_count: the read thread
        null,
        null,
        port,
        callJs,
        &tsfn,
    ) != c.napi_ok) {
        _ = close(fd);
        _ = close(wake[0]);
        _ = close(wake[1]);
        _ = c.napi_throw_error(env, null, "failed to create threadsafe function");
        return getUndefined(env);
    }

    port.fd = fd;
    port.wake_r = wake[0];
    port.wake_w = wake[1];
    port.tsfn = tsfn;
    port.stop.store(false, .seq_cst);
    port.is_open = true;

    port.thread = std.Thread.spawn(.{}, readLoop, .{port}) catch {
        _ = c.napi_release_threadsafe_function(tsfn, c.napi_tsfn_abort);
        _ = close(fd);
        _ = close(wake[0]);
        _ = close(wake[1]);
        port.* = .{};
        _ = c.napi_throw_error(env, null, "failed to spawn read thread");
        return getUndefined(env);
    };

    return getUndefined(env);
}

fn readLoop(port: *Port) void {
    var buf: [4096]u8 = undefined;
    while (!port.stop.load(.seq_cst)) {
        var fds = [_]std.c.pollfd{
            .{ .fd = port.fd, .events = std.c.POLL.IN, .revents = 0 },
            .{ .fd = port.wake_r, .events = std.c.POLL.IN, .revents = 0 },
        };
        const rc = poll(&fds, 2, -1);
        if (rc < 0) continue;
        if (fds[1].revents != 0) break; // woken for shutdown
        if (fds[0].revents & std.c.POLL.IN == 0) {
            // error/hangup on the device
            if (fds[0].revents & (std.c.POLL.ERR | std.c.POLL.HUP | std.c.POLL.NVAL) != 0) break;
            continue;
        }

        const n = read(port.fd, &buf, buf.len);
        if (n <= 0) break;

        const bytes = alloc.alloc(u8, @intCast(n)) catch continue;
        @memcpy(bytes, buf[0..@intCast(n)]);
        const chunk = alloc.create(Chunk) catch {
            alloc.free(bytes);
            continue;
        };
        chunk.* = .{ .bytes = bytes };
        if (c.napi_call_threadsafe_function(port.tsfn, chunk, c.napi_tsfn_nonblocking) != c.napi_ok) {
            alloc.free(bytes);
            alloc.destroy(chunk);
        }
    }
}

/// Runs on the JS/main thread. Delivers a chunk to cb(null, Buffer).
fn callJs(env: c.napi_env, js_cb: c.napi_value, _: ?*anyopaque, data: ?*anyopaque) callconv(.c) void {
    const chunk: *Chunk = @ptrCast(@alignCast(data orelse return));
    defer {
        alloc.free(chunk.bytes);
        alloc.destroy(chunk);
    }
    // env is null when the environment is tearing down; skip the call.
    if (env == null or js_cb == null) return;

    var buffer: c.napi_value = undefined;
    if (c.napi_create_buffer_copy(env, chunk.bytes.len, chunk.bytes.ptr, null, &buffer) != c.napi_ok) return;

    var null_val: c.napi_value = undefined;
    _ = c.napi_get_null(env, &null_val);
    var undef: c.napi_value = undefined;
    _ = c.napi_get_undefined(env, &undef);

    var args = [_]c.napi_value{ null_val, buffer };
    _ = c.napi_call_function(env, undef, js_cb, args.len, &args, null);
}

// ---------------------------------------------------------------------------
// write(buf) / drain()  -> Promise
// ---------------------------------------------------------------------------

fn jsWrite(env: c.napi_env, info: c.napi_callback_info) callconv(.c) c.napi_value {
    var argv: [1]c.napi_value = undefined;
    const this = cbThis(env, info, 1, &argv) catch return getUndefined(env);
    const port = unwrap(env, this) orelse return getUndefined(env);
    if (!port.is_open) return rejectNow(env, "Port is not open");

    var data_ptr: ?*anyopaque = null;
    var data_len: usize = 0;
    if (c.napi_get_buffer_info(env, argv[0], &data_ptr, &data_len) != c.napi_ok)
        return rejectNow(env, "write expects a Buffer");

    const copy = alloc.alloc(u8, data_len) catch return rejectNow(env, "out of memory");
    if (data_len > 0) {
        const src: [*]const u8 = @ptrCast(data_ptr.?);
        @memcpy(copy, src[0..data_len]);
    }
    return queueWork(env, port, .write, copy);
}

fn jsDrain(env: c.napi_env, info: c.napi_callback_info) callconv(.c) c.napi_value {
    const this = cbThis(env, info, 0, null) catch return getUndefined(env);
    const port = unwrap(env, this) orelse return getUndefined(env);
    if (!port.is_open) return rejectNow(env, "Port is not open");
    const empty = alloc.alloc(u8, 0) catch return rejectNow(env, "out of memory");
    return queueWork(env, port, .drain, empty);
}

fn queueWork(env: c.napi_env, port: *Port, kind: WorkKind, data: []u8) c.napi_value {
    var deferred: c.napi_deferred = undefined;
    var promise: c.napi_value = undefined;
    _ = c.napi_create_promise(env, &deferred, &promise);

    const w = alloc.create(Work) catch {
        alloc.free(data);
        return promise; // promise leaks unresolved on OOM; acceptable edge case
    };
    w.* = .{ .kind = kind, .fd = port.fd, .data = data, .deferred = deferred };

    var res_name: c.napi_value = undefined;
    _ = c.napi_create_string_utf8(env, "tinySerialWork", c.NAPI_AUTO_LENGTH, &res_name);
    _ = c.napi_create_async_work(env, null, res_name, workExecute, workComplete, w, &w.work);
    _ = c.napi_queue_async_work(env, w.work);
    return promise;
}

fn workExecute(_: c.napi_env, data: ?*anyopaque) callconv(.c) void {
    const w: *Work = @ptrCast(@alignCast(data orelse return));
    switch (w.kind) {
        .drain => {
            if (tcdrain(w.fd) != 0) {
                w.err_no = 1;
            } else w.ok = true;
        },
        .write => {
            var off: usize = 0;
            while (off < w.data.len) {
                const n = write(w.fd, w.data.ptr + off, w.data.len - off);
                if (n < 0) {
                    w.err_no = 1;
                    return;
                }
                off += @intCast(n);
            }
            w.ok = true;
        },
    }
}

fn workComplete(env: c.napi_env, status: c.napi_status, data: ?*anyopaque) callconv(.c) void {
    const w: *Work = @ptrCast(@alignCast(data orelse return));
    defer {
        _ = c.napi_delete_async_work(env, w.work);
        alloc.free(w.data);
        alloc.destroy(w);
    }

    if (status == c.napi_ok and w.ok) {
        var undef: c.napi_value = undefined;
        _ = c.napi_get_undefined(env, &undef);
        _ = c.napi_resolve_deferred(env, w.deferred, undef);
    } else {
        var msg: c.napi_value = undefined;
        const text = if (w.kind == .drain) "drain failed" else "write failed";
        _ = c.napi_create_string_utf8(env, text, c.NAPI_AUTO_LENGTH, &msg);
        var err: c.napi_value = undefined;
        _ = c.napi_create_error(env, null, msg, &err);
        _ = c.napi_reject_deferred(env, w.deferred, err);
    }
}

// ---------------------------------------------------------------------------
// close()
// ---------------------------------------------------------------------------

fn jsClose(env: c.napi_env, info: c.napi_callback_info) callconv(.c) c.napi_value {
    const this = cbThis(env, info, 0, null) catch return getUndefined(env);
    const port = unwrap(env, this) orelse return getUndefined(env);
    shutdown(port);
    return getUndefined(env);
}

/// Idempotent teardown: stop the read thread, release the TSFN, close fds.
fn shutdown(port: *Port) void {
    if (!port.is_open) return;
    port.is_open = false;
    port.stop.store(true, .seq_cst);

    // wake the poll() in the read thread
    if (port.wake_w >= 0) {
        const one = [_]u8{0};
        _ = write(port.wake_w, &one, 1);
    }
    if (port.thread) |t| {
        t.join();
        port.thread = null;
    }
    if (port.tsfn != null) {
        _ = c.napi_release_threadsafe_function(port.tsfn, c.napi_tsfn_release);
        port.tsfn = null;
    }
    if (port.fd >= 0) {
        _ = close(port.fd);
        port.fd = -1;
    }
    if (port.wake_r >= 0) {
        _ = close(port.wake_r);
        port.wake_r = -1;
    }
    if (port.wake_w >= 0) {
        _ = close(port.wake_w);
        port.wake_w = -1;
    }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

fn getUndefined(env: c.napi_env) c.napi_value {
    var undef: c.napi_value = undefined;
    _ = c.napi_get_undefined(env, &undef);
    return undef;
}

/// Reads callback info, returning `this`. `argc` is the expected arg count;
/// `argv` receives the arguments (pass null when argc == 0).
fn cbThis(env: c.napi_env, info: c.napi_callback_info, comptime argc: usize, argv: ?*[argc]c.napi_value) !c.napi_value {
    var n: usize = argc;
    var this: c.napi_value = undefined;
    const argv_ptr: [*c]c.napi_value = if (argc == 0) null else @ptrCast(argv.?);
    if (c.napi_get_cb_info(env, info, &n, argv_ptr, &this, null) != c.napi_ok) {
        _ = c.napi_throw_error(env, null, "failed to read arguments");
        return error.CbInfo;
    }
    return this;
}

fn unwrap(env: c.napi_env, this: c.napi_value) ?*Port {
    var data: ?*anyopaque = null;
    if (c.napi_unwrap(env, this, &data) != c.napi_ok) return null;
    return @ptrCast(@alignCast(data orelse return null));
}

fn rejectNow(env: c.napi_env, msg: [:0]const u8) c.napi_value {
    var deferred: c.napi_deferred = undefined;
    var promise: c.napi_value = undefined;
    _ = c.napi_create_promise(env, &deferred, &promise);
    var text: c.napi_value = undefined;
    _ = c.napi_create_string_utf8(env, msg.ptr, c.NAPI_AUTO_LENGTH, &text);
    var err: c.napi_value = undefined;
    _ = c.napi_create_error(env, null, text, &err);
    _ = c.napi_reject_deferred(env, deferred, err);
    return promise;
}
