from pathlib import Path
p = Path('server.js')
s = p.read_text(encoding='utf-8')

def repl(old, new, label, expected=1):
    global s
    c = s.count(old)
    if c != expected:
        raise SystemExit(f'{label}: expected {expected}, got {c}')
    s = s.replace(old, new, expected)

repl(
    'const MAX_BOT_MESSAGES = 30;',
    '''// 0 = sin límite artificial de turnos. Si alguna vez se necesita un tope de seguridad,
// puede configurarse explícitamente en Render sin cambiar código.
const MAX_BOT_MESSAGES = Math.max(0, Number(process.env.ANTONIA_MAX_BOT_MESSAGES || 0));

function botMessageLimitReached(count) {
  return MAX_BOT_MESSAGES > 0 && Number(count || 0) >= MAX_BOT_MESSAGES;
}''',
    'config max bot messages'
)

repl(
    'if (state.system.botMessagesSent >= MAX_BOT_MESSAGES) {',
    'if (botMessageLimitReached(state.system.botMessagesSent)) {',
    'pre-inbound max check'
)

repl(
    '} else if (latestState.system.botMessagesSent >= MAX_BOT_MESSAGES) {',
    '} else if (botMessageLimitReached(latestState.system.botMessagesSent)) {',
    'post-send max check'
)

old_resume = '''  if (state.system.handoffReason === "max_bot_messages_reached") {
    state.system.botMessagesSent = MAX_BOT_MESSAGES - 1;
  }'''
new_resume = '''  if (state.system.handoffReason === "max_bot_messages_reached" && MAX_BOT_MESSAGES > 0) {
    state.system.botMessagesSent = Math.max(0, MAX_BOT_MESSAGES - 1);
  }'''
repl(old_resume, new_resume, 'legacy max resume')

p.write_text(s, encoding='utf-8')
