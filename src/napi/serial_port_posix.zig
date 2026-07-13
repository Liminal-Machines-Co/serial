//! Native `NativeSerialPort` class backing src/SerialPort.ts.
//!
//! Contract (see src/types.ts INativeSerialPort):
//!   open(path, config, cb(err, data: Buffer))  - start background reads
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
const napi = @import("napi.zig");
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
    return napi.defineClass(env, "NativeSerialPort", construct, &.{
        .{ .name = "open", .cb = jsOpen },
        .{ .name = "write", .cb = jsWrite },
        .{ .name = "drain", .cb = jsDrain },
        .{ .name = "close", .cb = jsClose },
    });
}

fn construct(env: c.napi_env, info: c.napi_callback_info) callconv(.c) c.napi_value {
    const cb = napi.cbInfo(env, info, 0) catch return napi.getUndefined(env);
    const port = alloc.create(Port) catch {
        napi.throwError(env, "out of memory");
        return napi.getUndefined(env);
    };
    port.* = .{};
    napi.wrap(env, cb.this, port, finalize);
    return cb.this;
}

fn finalize(_: c.napi_env, data: ?*anyopaque, _: ?*anyopaque) callconv(.c) void {
    const port: *Port = @ptrCast(@alignCast(data orelse return));
    shutdown(port);
    alloc.destroy(port);
}

// ---------------------------------------------------------------------------
// open(path, config, cb)
// ---------------------------------------------------------------------------

fn jsOpen(env: c.napi_env, info: c.napi_callback_info) callconv(.c) c.napi_value {
    const cb = napi.cbInfo(env, info, 3) catch return napi.getUndefined(env);
    const argv = cb.argv;
    const port = napi.unwrap(env, cb.this, Port) orelse return napi.getUndefined(env);

    if (port.is_open) {
        napi.throwError(env, "Port is already open");
        return napi.getUndefined(env);
    }

    // path
    var path_buf: [std.fs.max_path_bytes]u8 = undefined;
    var path_len: usize = 0;
    if (c.napi_get_value_string_utf8(env, argv[0], &path_buf, path_buf.len, &path_len) != c.napi_ok) {
        napi.throwError(env, "invalid path");
        return napi.getUndefined(env);
    }
    path_buf[path_len] = 0;
    const path_z: [*:0]const u8 = @ptrCast(&path_buf);

    // config object (argv[1])
    const config_obj = argv[1];
    const baud: u32 = napi.getNamedU32(env, config_obj, "baudRate") orelse 0;

    // open device
    const oflag = std.c.O{ .ACCMODE = .RDWR, .NOCTTY = true };
    const fd = std.c.open(path_z, oflag, @as(std.c.mode_t, 0));
    if (fd < 0) {
        napi.throwError(env, "failed to open serial port");
        return napi.getUndefined(env);
    }
    errdefer _ = close(fd);

    // configure line settings unless baudRate == 0 (PTY/skip sentinel)
    if (baud != 0) {
        const word_size: serial.WordSize = switch (napi.getNamedU32(env, config_obj, "dataBits") orelse 8) {
            5 => .five,
            6 => .six,
            7 => .seven,
            else => .eight,
        };

        const stop_bits: serial.StopBits = if ((napi.getNamedF64(env, config_obj, "stopBits") orelse 1) == 2)
            .two
        else
            .one;

        var parity_buf: [16]u8 = undefined;
        const parity: serial.Parity = if (napi.getNamedStringUtf8(env, config_obj, "parity", &parity_buf)) |p| blk: {
            if (std.mem.eql(u8, p, "odd")) break :blk .odd;
            if (std.mem.eql(u8, p, "even")) break :blk .even;
            if (std.mem.eql(u8, p, "mark")) break :blk .mark;
            if (std.mem.eql(u8, p, "space")) break :blk .space;
            break :blk .none;
        } else .none;

        const rtscts = napi.getNamedBool(env, config_obj, "rtscts") orelse false;
        const xon = napi.getNamedBool(env, config_obj, "xon") orelse false;
        const xoff = napi.getNamedBool(env, config_obj, "xoff") orelse false;
        const handshake: serial.Handshake = if (rtscts)
            .hardware
        else if (xon or xoff)
            .software
        else
            .none;

        const file = std.Io.File{ .handle = fd, .flags = .{ .nonblocking = false } };
        serial.configureSerialPort(file, .{
            .baud_rate = baud,
            .word_size = word_size,
            .stop_bits = stop_bits,
            .parity = parity,
            .handshake = handshake,
        }) catch {
            _ = close(fd);
            napi.throwError(env, "failed to configure serial port");
            return napi.getUndefined(env);
        };
    }

    // self-pipe to wake the read thread on close
    var wake: [2]std.c.fd_t = undefined;
    if (pipe(&wake) != 0) {
        _ = close(fd);
        napi.throwError(env, "failed to create wake pipe");
        return napi.getUndefined(env);
    }

    // threadsafe function wrapping the JS callback
    const res_name = napi.createStringUtf8(env, "tinySerialRead");
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
        napi.throwError(env, "failed to create threadsafe function");
        return napi.getUndefined(env);
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
        napi.throwError(env, "failed to spawn read thread");
        return napi.getUndefined(env);
    };

    return napi.getUndefined(env);
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

    const buffer = napi.createBufferCopy(env, chunk.bytes) orelse return;

    var args = [_]c.napi_value{ napi.getNull(env), buffer };
    _ = c.napi_call_function(env, napi.getUndefined(env), js_cb, args.len, &args, null);
}

// ---------------------------------------------------------------------------
// write(buf) / drain()  -> Promise
// ---------------------------------------------------------------------------

fn jsWrite(env: c.napi_env, info: c.napi_callback_info) callconv(.c) c.napi_value {
    const cb = napi.cbInfo(env, info, 1) catch return napi.getUndefined(env);
    const argv = cb.argv;
    const port = napi.unwrap(env, cb.this, Port) orelse return napi.getUndefined(env);
    if (!port.is_open) return napi.rejectNow(env, "Port is not open");

    var data_ptr: ?*anyopaque = null;
    var data_len: usize = 0;
    if (c.napi_get_buffer_info(env, argv[0], &data_ptr, &data_len) != c.napi_ok)
        return napi.rejectNow(env, "write expects a Buffer");

    const copy = alloc.alloc(u8, data_len) catch return napi.rejectNow(env, "out of memory");
    if (data_len > 0) {
        const src: [*]const u8 = @ptrCast(data_ptr.?);
        @memcpy(copy, src[0..data_len]);
    }
    return queueWork(env, port, .write, copy);
}

fn jsDrain(env: c.napi_env, info: c.napi_callback_info) callconv(.c) c.napi_value {
    const cb = napi.cbInfo(env, info, 0) catch return napi.getUndefined(env);
    const port = napi.unwrap(env, cb.this, Port) orelse return napi.getUndefined(env);
    if (!port.is_open) return napi.rejectNow(env, "Port is not open");
    const empty = alloc.alloc(u8, 0) catch return napi.rejectNow(env, "out of memory");
    return queueWork(env, port, .drain, empty);
}

fn queueWork(env: c.napi_env, port: *Port, kind: WorkKind, data: []u8) c.napi_value {
    const p = napi.createPromise(env);

    const w = alloc.create(Work) catch {
        alloc.free(data);
        return p.promise; // promise leaks unresolved on OOM; acceptable edge case
    };
    w.* = .{ .kind = kind, .fd = port.fd, .data = data, .deferred = p.deferred };

    const res_name = napi.createStringUtf8(env, "tinySerialWork");
    _ = c.napi_create_async_work(env, null, res_name, workExecute, workComplete, w, &w.work);
    _ = c.napi_queue_async_work(env, w.work);
    return p.promise;
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
        napi.resolve(env, w.deferred, napi.getUndefined(env));
    } else {
        const text = if (w.kind == .drain) "drain failed" else "write failed";
        napi.reject(env, w.deferred, napi.createError(env, text));
    }
}

// ---------------------------------------------------------------------------
// close()
// ---------------------------------------------------------------------------

fn jsClose(env: c.napi_env, info: c.napi_callback_info) callconv(.c) c.napi_value {
    const cb = napi.cbInfo(env, info, 0) catch return napi.getUndefined(env);
    const port = napi.unwrap(env, cb.this, Port) orelse return napi.getUndefined(env);
    shutdown(port);
    return napi.getUndefined(env);
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
