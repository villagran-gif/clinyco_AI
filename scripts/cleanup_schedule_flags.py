from pathlib import Path
p = Path('server.js')
s = p.read_text()
dup = '        state.booking.awaitingScheduleQuery = true;\n        state.booking.awaitingScheduleQuery = true;'
count = s.count(dup)
assert count == 2, f'expected 2 duplicated flag pairs, found {count}'
s = s.replace(dup, '        state.booking.awaitingScheduleQuery = true;')
assert s.count(dup) == 0
p.write_text(s)
