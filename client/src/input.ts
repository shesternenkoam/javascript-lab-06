export interface KeyState {
  w: boolean;
  a: boolean;
  d: boolean;
  space: boolean;
}

export function createInput(): () => KeyState {
  const keys: KeyState = { w: false, a: false, d: false, space: false };
  const alias: Record<string, keyof KeyState | undefined> = {
    arrowup: 'w',
    arrowleft: 'a',
    arrowright: 'd',
    ' ': 'space',
  };

  const keyOf = (e: KeyboardEvent): string => {
    const k = e.key.toLowerCase();
    return alias[k] ?? k;
  };

  const isKey = (k: string): k is keyof KeyState => k in keys;

  const handleKeyDown = (e: KeyboardEvent): void => {
    const key = keyOf(e);
    if (isKey(key)) {
      keys[key] = true;
      if (key === 'space') e.preventDefault();
    }
  };

  const handleKeyUp = (e: KeyboardEvent): void => {
    const key = keyOf(e);
    if (isKey(key)) keys[key] = false;
  };

  const handleBlur = (): void => {
    keys.w = false;
    keys.a = false;
    keys.d = false;
    keys.space = false;
  };

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('blur', handleBlur);

  return (): KeyState => ({ ...keys });
}
