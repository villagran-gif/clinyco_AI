from pathlib import Path

p = Path('server.js')
s = p.read_text()
marker = '      if (state.booking?.awaitingScheduleQuery) {'
anchor = '      if (isSimpleScheduleRequest(userText) && !parseRequestedCareMode(userText)) {'
positions = []
start = 0
while True:
    i = s.find(marker, start)
    if i < 0:
        break
    positions.append(i)
    start = i + len(marker)

assert len(positions) == 2, f'expected exactly 2 duplicated interceptors, found {len(positions)}'
first, second = positions
anchor_pos = s.find(anchor, second)
assert anchor_pos > second, 'simple schedule anchor not found after duplicate'
block1 = s[first:second].strip()
block2 = s[second:anchor_pos].strip()
assert block1 == block2, 'interceptors differ; refusing automatic cleanup'
s = s[:second] + s[anchor_pos:]
assert s.count(marker) == 1
p.write_text(s)
