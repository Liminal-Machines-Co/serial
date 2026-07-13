//! Windows stub for NativeSerialPort.
//!
//! Enumeration and the JS/TS layer already work on Windows; only the native
//! serial IO (CreateFile + overlapped ReadFile/WriteFile, DCB config) is not yet
//! implemented. The class is still exposed so `require()` succeeds and the shape
//! matches other platforms; each method throws until this is filled in.
const c = @import("c");
const napi = @import("napi.zig");

pub fn defineClass(env: c.napi_env) c.napi_value {
    return napi.defineClass(env, "NativeSerialPort", construct, &.{
        .{ .name = "open", .cb = notImplemented },
        .{ .name = "write", .cb = notImplemented },
        .{ .name = "drain", .cb = notImplemented },
        .{ .name = "close", .cb = notImplemented },
    });
}

fn construct(env: c.napi_env, info: c.napi_callback_info) callconv(.c) c.napi_value {
    _ = info;
    return napi.getUndefined(env);
}

fn notImplemented(env: c.napi_env, info: c.napi_callback_info) callconv(.c) c.napi_value {
    _ = info;
    napi.throwError(env, "@liminal-machines-co/serial: native serial IO is not yet implemented on Windows");
    return napi.getUndefined(env);
}
