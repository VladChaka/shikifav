import base64, json, os, socket, struct
from urllib.parse import urlparse

class WS:
    """Минимальный клиент WebSocket под CDP: текстовые кадры, маскирование,
    сборка фрагментов. Хватает ровно на то, что нужно (скриншоты — большие
    payload'ы, поэтому 64-битная длина обязательна)."""
    def __init__(self, url):
        u = urlparse(url)
        self.s = socket.create_connection((u.hostname, u.port or 80), timeout=60)
        key = base64.b64encode(os.urandom(16)).decode()
        path = u.path + (('?' + u.query) if u.query else '')
        req = (f"GET {path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\n"
               f"Upgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n"
               f"Origin: http://127.0.0.1:{u.port}\r\n\r\n")
        self.s.sendall(req.encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            buf += self.s.recv(4096)
        if b'101' not in buf.split(b'\r\n')[0]:
            raise RuntimeError('handshake: ' + buf.split(b'\r\n')[0].decode())
        self.rest = buf.split(b'\r\n\r\n', 1)[1]

    def _read(self, n):
        while len(self.rest) < n:
            chunk = self.s.recv(max(65536, n - len(self.rest)))
            if not chunk: raise ConnectionError('соединение закрыто')
            self.rest += chunk
        out, self.rest = self.rest[:n], self.rest[n:]
        return out

    def send(self, text):
        data = text.encode()
        head = bytearray([0x81])
        n = len(data)
        if n < 126: head.append(0x80 | n)
        elif n < 65536: head.append(0x80 | 126); head += struct.pack('>H', n)
        else: head.append(0x80 | 127); head += struct.pack('>Q', n)
        mask = os.urandom(4)
        head += mask
        self.s.sendall(bytes(head) + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv(self):
        payload = b''
        while True:
            b0, b1 = self._read(2)
            fin, opcode = b0 & 0x80, b0 & 0x0F
            ln = b1 & 0x7F
            if ln == 126: ln = struct.unpack('>H', self._read(2))[0]
            elif ln == 127: ln = struct.unpack('>Q', self._read(8))[0]
            chunk = self._read(ln)
            if opcode == 0x9:  # ping
                self.s.sendall(bytes([0x8A, 0x80]) + os.urandom(4)); continue
            if opcode == 0x8: raise ConnectionError('close frame')
            payload += chunk
            if fin: return payload.decode()

    def close(self):
        try: self.s.close()
        except Exception: pass
