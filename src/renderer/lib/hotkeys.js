/** Map a keyboard event to an Electron accelerator, or null if invalid. */
export function eventToAccelerator(e) {
  const key = codeToAcceleratorKey(e.code);
  if (!key) return null;
  if (key === 'Escape') return null;

  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  const functionKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(key);
  if (!parts.length && !functionKey) return null;

  parts.push(key);
  return parts.join('+');
}

export function formatAccelerator(acc) {
  if (!acc) return 'Not set';
  return String(acc)
    .replace(/CommandOrControl/g, 'Ctrl')
    .replace(/Command/g, 'Ctrl')
    .replace(/\+/g, ' + ');
}

function codeToAcceleratorKey(code) {
  if (!code) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  const map = {
    Space: 'Space',
    Tab: 'Tab',
    Enter: 'Enter',
    Backspace: 'Backspace',
    Insert: 'Insert',
    Delete: 'Delete',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: '\'',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backquote: '`',
  };
  return map[code] || null;
}
