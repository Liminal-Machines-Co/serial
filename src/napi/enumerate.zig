//! Cross-platform serial port enumeration.
//!
//! We scan `/dev` directly (libc opendir/readdir) rather than going through the
//! `serial` library's iterators: its Darwin iterator is currently broken for
//! Zig 0.16, and a plain directory scan needs no framework linking (IOKit /
//! SetupAPI), which keeps cross-compilation clean. Windows enumeration is a
//! follow-up (see note in `scan`).
const std = @import("std");
const builtin = @import("builtin");

pub const Entry = struct {
    /// Heap-allocated absolute device path, e.g. "/dev/cu.usbserial-1420".
    path: []u8,
    /// Static classifier string surfaced as PortInfo.portType.
    port_type: []const u8,
};

// readdir is not exposed as `pub` by std.c, so declare it ourselves.
extern "c" fn readdir(dir: *std.c.DIR) ?*std.c.dirent;

pub fn scan(allocator: std.mem.Allocator) ![]Entry {
    var list: std.ArrayList(Entry) = .empty;
    errdefer free(allocator, list.items);

    switch (builtin.os.tag) {
        .macos, .linux, .freebsd => try scanDev(allocator, &list),
        // TODO(windows): enumerate via SERIALCOMM registry key.
        else => {},
    }

    return list.toOwnedSlice(allocator);
}

pub fn free(allocator: std.mem.Allocator, entries: []Entry) void {
    for (entries) |e| allocator.free(e.path);
    allocator.free(entries);
}

fn scanDev(allocator: std.mem.Allocator, list: *std.ArrayList(Entry)) !void {
    const dir = std.c.opendir("/dev") orelse return;
    defer _ = std.c.closedir(dir);

    while (readdir(dir)) |ent| {
        const name = std.mem.sliceTo(&ent.name, 0);
        const port_type = classify(name) orelse continue;
        const path = try std.fmt.allocPrint(allocator, "/dev/{s}", .{name});
        errdefer allocator.free(path);
        try list.append(allocator, .{ .path = path, .port_type = port_type });
    }
}

/// Returns a portType string for device names that look like serial ports, or
/// null to skip the entry.
fn classify(name: []const u8) ?[]const u8 {
    return switch (builtin.os.tag) {
        // On macOS use the call-out ("cu.") devices, not the "tty." dial-in
        // ones — cu.* does not block waiting for carrier detect.
        .macos => if (std.mem.startsWith(u8, name, "cu.")) "cu" else null,
        .linux => if (std.mem.startsWith(u8, name, "ttyUSB"))
            "usb"
        else if (std.mem.startsWith(u8, name, "ttyACM"))
            "acm"
        else if (std.mem.startsWith(u8, name, "ttyAMA"))
            "native"
        else if (std.mem.startsWith(u8, name, "ttyS"))
            "native"
        else
            null,
        .freebsd => if (std.mem.startsWith(u8, name, "cua")) "cu" else null,
        else => null,
    };
}
