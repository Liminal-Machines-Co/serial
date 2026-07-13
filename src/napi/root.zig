const std = @import("std");
const c = @import("c");
const enumerate = @import("enumerate.zig");
const serial_port = @import("serial_port.zig");

const alloc = std.heap.c_allocator;

/// napi_register_module_v1 is the entry point Node calls when the addon loads.
fn registerModule(env: c.napi_env, exports: c.napi_value) callconv(.c) c.napi_value {
    // NativeSerialPort class
    const class = serial_port.defineClass(env);
    _ = c.napi_set_named_property(env, exports, "NativeSerialPort", class);

    // listPorts()
    var list_ports_fn: c.napi_value = undefined;
    if (c.napi_create_function(env, "listPorts", c.NAPI_AUTO_LENGTH, listPorts, null, &list_ports_fn) == c.napi_ok) {
        _ = c.napi_set_named_property(env, exports, "listPorts", list_ports_fn);
    }

    return exports;
}

fn listPorts(env: c.napi_env, info: c.napi_callback_info) callconv(.c) c.napi_value {
    _ = info;

    var arr: c.napi_value = undefined;
    _ = c.napi_create_array(env, &arr);

    const entries = enumerate.scan(alloc) catch return arr;
    defer enumerate.free(alloc, entries);

    for (entries, 0..) |entry, i| {
        var obj: c.napi_value = undefined;
        _ = c.napi_create_object(env, &obj);

        var path_val: c.napi_value = undefined;
        _ = c.napi_create_string_utf8(env, entry.path.ptr, entry.path.len, &path_val);
        _ = c.napi_set_named_property(env, obj, "path", path_val);

        var type_val: c.napi_value = undefined;
        _ = c.napi_create_string_utf8(env, entry.port_type.ptr, entry.port_type.len, &type_val);
        _ = c.napi_set_named_property(env, obj, "portType", type_val);

        _ = c.napi_set_element(env, arr, @intCast(i), obj);
    }

    return arr;
}

comptime {
    @export(&registerModule, .{ .name = "napi_register_module_v1" });
}
