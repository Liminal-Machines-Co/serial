//! Windows stub for NativeSerialPort.
//!
//! Enumeration and the JS/TS layer already work on Windows; only the native
//! serial IO (CreateFile + overlapped ReadFile/WriteFile, DCB config) is not yet
//! implemented. The class is still exposed so `require()` succeeds and the shape
//! matches other platforms; each method throws until this is filled in.
const c = @import("c");

pub fn defineClass(env: c.napi_env) c.napi_value {
    const props = [_]c.napi_property_descriptor{
        method("open", notImplemented),
        method("write", notImplemented),
        method("drain", notImplemented),
        method("close", notImplemented),
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
    _ = info;
    var this: c.napi_value = undefined;
    _ = c.napi_get_undefined(env, &this);
    return this;
}

fn notImplemented(env: c.napi_env, info: c.napi_callback_info) callconv(.c) c.napi_value {
    _ = info;
    _ = c.napi_throw_error(env, null, "tiny-serial: native serial IO is not yet implemented on Windows");
    var undef: c.napi_value = undefined;
    _ = c.napi_get_undefined(env, &undef);
    return undef;
}
