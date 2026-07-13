//! OS dispatcher for the NativeSerialPort class.
//!
//! POSIX (macOS/Linux/BSD) has a full implementation. Windows serial IO is a
//! follow-up: it compiles and exposes the class, but the methods throw. Zig's
//! lazy analysis means only the selected implementation is compiled.
const builtin = @import("builtin");

const impl = if (builtin.os.tag == .windows)
    @import("serial_port_windows.zig")
else
    @import("serial_port_posix.zig");

pub const defineClass = impl.defineClass;
