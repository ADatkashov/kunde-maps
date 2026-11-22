"""Polyline (precision 6, as emitted by Valhalla) decoding and a small Douglas-Peucker simplifier. stdlib only."""


def decode(encoded, precision=6):
    """Return [(lat, lon), ...]. Raises ValueError on malformed input."""
    factor = 10 ** precision
    coords, index, lat, lon = [], 0, 0, 0
    while index < len(encoded):
        for which in (0, 1):
            shift = result = 0
            while True:
                if index >= len(encoded):
                    raise ValueError("truncated polyline")
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
                if shift > 60:
                    raise ValueError("polyline value too long")
            delta = ~(result >> 1) if result & 1 else result >> 1
            if which == 0:
                lat += delta
            else:
                lon += delta
        coords.append((lat / factor, lon / factor))
    return coords


def encode(points, precision=6):
    factor, out, prev_lat, prev_lon = 10 ** precision, [], 0, 0
    for lat, lon in points:
        for value, prev in ((round(lat * factor), prev_lat), (round(lon * factor), prev_lon)):
            delta = value - prev
            delta = ~(delta << 1) if delta < 0 else delta << 1
            while delta >= 0x20:
                out.append(chr((0x20 | (delta & 0x1F)) + 63))
                delta >>= 5
            out.append(chr(delta + 63))
        prev_lat, prev_lon = round(lat * factor), round(lon * factor)
    return "".join(out)


def simplify(points, tolerance):
    """Douglas-Peucker (iterative). Returns the indexes of kept points; first and last are always kept."""
    n = len(points)
    if n <= 2 or tolerance <= 0:
        return list(range(n))
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        (ay, ax), (by, bx) = points[a], points[b]
        dx, dy = bx - ax, by - ay
        length2 = dx * dx + dy * dy
        worst, worst_i = 0.0, -1
        for i in range(a + 1, b):
            py, px = points[i]
            if length2 == 0:
                d2 = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length2))
                d2 = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2
            if d2 > worst:
                worst, worst_i = d2, i
        if worst_i >= 0 and worst > tolerance * tolerance:
            keep[worst_i] = True
            stack.append((a, worst_i))
            stack.append((worst_i, b))
    return [i for i, k in enumerate(keep) if k]
