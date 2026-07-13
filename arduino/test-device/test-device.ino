/*
 * test-device — tiny-serial CLI test fixture
 *
 * Flash to any Arduino (Uno, Nano, Mega, …).
 * Default: 9600 8N1. Change BAUD below to test other rates.
 *
 * All commands are newline-terminated (\n or \r\n).
 *
 * COMMANDS
 * --------
 *   PING              → "PONG\n"
 *   ECHO <text>       → "<text>\n"
 *   ID                → "tiny-serial-test v1.0\n"
 *   SLOW <ms>         → waits <ms>, then "OK\n"   (timeout testing)
 *   CRLF              → "hello\r\n"               (--delimiter \r\n)
 *   LINES <n>         → <n> lines "tick 1\n" …    (stream testing)
 *   PARITY            → "parity-ok\n"             (re-flash with SERIAL_8E1 etc.)
 *   BINARY            → 4 raw bytes 0x01 0x02 0x03 0x04  (--raw stream)
 *
 * CLI EXAMPLES
 * ------------
 *   tiny-serial list
 *   tiny-serial write  -p /dev/ttyUSB0 -b 9600 "PING\n"
 *   tiny-serial write  -p /dev/ttyUSB0 -b 9600 --timeout 2000 "PING\n"
 *   tiny-serial write  -p /dev/ttyUSB0 -b 9600 --timeout 2000 "SLOW 1500\n"
 *   tiny-serial write  -p /dev/ttyUSB0 -b 9600 --timeout 500  "SLOW 1500\n"  # exits 1
 *   tiny-serial write  -p /dev/ttyUSB0 -b 9600 --delimiter $'\r\n' "CRLF\n"
 *   tiny-serial write  -p /dev/ttyUSB0 -b 9600 --timeout 2000 "ECHO hello world\n"
 *   tiny-serial stream -p /dev/ttyUSB0 -b 9600
 *   tiny-serial stream -p /dev/ttyUSB0 -b 9600 --raw | xxd
 *
 * STOP BITS / PARITY
 * ------------------
 * Change the Serial.begin() config constant and re-flash:
 *   SERIAL_8N1  (default) — 8 data, no parity, 1 stop
 *   SERIAL_8N2            — 8 data, no parity, 2 stop  → --stop-bits 2
 *   SERIAL_8E1            — 8 data, even parity        → --parity even
 *   SERIAL_8O1            — 8 data, odd parity         → --parity odd
 */

#define BAUD      9600
#define SERIAL_CFG SERIAL_8N1   // swap to test other configs
#define CMD_BUF   64

char buf[CMD_BUF];
uint8_t pos = 0;

void setup() {
  Serial.begin(BAUD, SERIAL_CFG);
  while (!Serial) {}   // wait for USB-CDC on Leonardo / Pro Micro
  Serial.println("ready");
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();

    // strip \r, treat \n as end-of-command
    if (c == '\r') continue;

    if (c == '\n') {
      buf[pos] = '\0';
      handleCommand(buf);
      pos = 0;
      return;
    }

    if (pos < CMD_BUF - 1) {
      buf[pos++] = c;
    }
  }
}

void handleCommand(const char* cmd) {
  // PING
  if (strcmp(cmd, "PING") == 0) {
    Serial.println("PONG");
    return;
  }

  // ECHO <text>
  if (strncmp(cmd, "ECHO ", 5) == 0) {
    Serial.println(cmd + 5);
    return;
  }

  // ID
  if (strcmp(cmd, "ID") == 0) {
    Serial.println("tiny-serial-test v1.0");
    return;
  }

  // SLOW <ms> — reply after a delay (tests --timeout)
  if (strncmp(cmd, "SLOW ", 5) == 0) {
    long ms = atol(cmd + 5);
    delay(ms);
    Serial.println("OK");
    return;
  }

  // CRLF — reply with \r\n delimiter (tests --delimiter \r\n)
  if (strcmp(cmd, "CRLF") == 0) {
    Serial.print("hello\r\n");
    return;
  }

  // LINES <n> — emit n newline-terminated lines (tests stream)
  if (strncmp(cmd, "LINES ", 6) == 0) {
    int n = atoi(cmd + 6);
    for (int i = 1; i <= n; i++) {
      Serial.print("tick ");
      Serial.println(i);
      delay(100);
    }
    return;
  }

  // PARITY — simple round-trip to verify parity config
  if (strcmp(cmd, "PARITY") == 0) {
    Serial.println("parity-ok");
    return;
  }

  // BINARY — 4 raw bytes (tests --raw stream / xxd)
  if (strcmp(cmd, "BINARY") == 0) {
    const uint8_t bytes[] = { 0x01, 0x02, 0x03, 0x04 };
    Serial.write(bytes, sizeof(bytes));
    return;
  }

  // unknown command
  Serial.print("unknown: ");
  Serial.println(cmd);
}
