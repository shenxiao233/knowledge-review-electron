(function () {
  const q = (selector) => document.querySelector(selector);
  const scene = q('#marketCharactersScene');
  const serverKey = q('#marketServerKey');
  const username = q('#marketUsername');
  const password = q('#marketPassword');
  const toggle = q('#marketPasswordToggle');
  const form = q('#marketAuthForm');
  const error = q('#marketLoginError');
  if (!scene || !serverKey || !username || !password || !form) return;

  let mouseX = 0;
  let mouseY = 0;
  let isTyping = false;
  let isPasswordFocused = false;
  let showPassword = false;
  let isLoginError = false;
  let isLookingAtEachOther = false;
  let purpleBlinking = false;
  let blackBlinking = false;
  let typingTimer = null;
  let errorTimer = null;

  const characters = {
    purple: { body: q('#marketCharPurple'), eyes: q('#marketPurpleEyes'), eyeL: q('#marketPurpleEyeL'), eyeR: q('#marketPurpleEyeR'), pupilL: q('#marketPurplePupilL'), pupilR: q('#marketPurplePupilR'), baseX: 45, baseY: 40, max: 5 },
    black: { body: q('#marketCharBlack'), eyes: q('#marketBlackEyes'), eyeL: q('#marketBlackEyeL'), eyeR: q('#marketBlackEyeR'), pupilL: q('#marketBlackPupilL'), pupilR: q('#marketBlackPupilR'), baseX: 26, baseY: 32, max: 4 },
    orange: { body: q('#marketCharOrange'), eyes: q('#marketOrangeEyes'), pupilL: q('#marketOrangePupilL'), pupilR: q('#marketOrangePupilR'), baseX: 82, baseY: 90, max: 5 },
    yellow: { body: q('#marketCharYellow'), eyes: q('#marketYellowEyes'), pupilL: q('#marketYellowPupilL'), pupilR: q('#marketYellowPupilR'), mouth: q('#marketYellowMouth'), baseX: 52, baseY: 40, max: 5 }
  };

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function position(character) {
    const rect = character.body.getBoundingClientRect();
    const dx = mouseX - (rect.left + rect.width / 2);
    const dy = mouseY - (rect.top + rect.height / 3);
    return { faceX: clamp(dx / 20, -15, 15), faceY: clamp(dy / 30, -10, 10), skew: clamp(-dx / 120, -6, 6) };
  }
  function pupil(character, element, maxDistance) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const dx = mouseX - (rect.left + rect.width / 2);
    const dy = mouseY - (rect.top + rect.height / 2);
    const distance = Math.min(Math.hypot(dx, dy), maxDistance);
    const angle = Math.atan2(dy, dx);
    return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
  }
  function setPupils(character, x, y) {
    character.pupilL?.style.setProperty('transform', `translate(${x}px, ${y}px)`);
    character.pupilR?.style.setProperty('transform', `translate(${x}px, ${y}px)`);
  }
  function update() {
    const pwdVisible = password.value.length > 0 && showPassword;
    const lookingAway = isPasswordFocused && !showPassword;
    const purplePosition = position(characters.purple);
    const blackPosition = position(characters.black);
    const orangePosition = position(characters.orange);
    const yellowPosition = position(characters.yellow);

    characters.purple.body.style.transform = pwdVisible ? 'skewX(0deg)' : lookingAway ? 'skewX(-14deg) translateX(-20px)' : isTyping ? `skewX(${purplePosition.skew - 12}deg) translateX(28px)` : `skewX(${purplePosition.skew}deg)`;
    characters.black.body.style.transform = pwdVisible ? 'skewX(0deg)' : lookingAway ? 'skewX(12deg) translateX(-10px)' : isLookingAtEachOther ? `skewX(${blackPosition.skew * 1.5 + 10}deg) translateX(20px)` : `skewX(${blackPosition.skew * 1.5}deg)`;
    characters.orange.body.style.transform = pwdVisible ? 'skewX(0deg)' : `skewX(${orangePosition.skew}deg)`;
    characters.yellow.body.style.transform = pwdVisible ? 'skewX(0deg)' : `skewX(${yellowPosition.skew}deg)`;

    characters.purple.eyeL.style.height = purpleBlinking ? '2px' : '18px';
    characters.purple.eyeR.style.height = purpleBlinking ? '2px' : '18px';
    characters.black.eyeL.style.height = blackBlinking ? '2px' : '16px';
    characters.black.eyeR.style.height = blackBlinking ? '2px' : '16px';

    if (isLoginError) {
      characters.purple.eyes.style.left = '30px'; characters.purple.eyes.style.top = '55px'; setPupils(characters.purple, -3, 4);
      characters.black.eyes.style.left = '15px'; characters.black.eyes.style.top = '40px'; setPupils(characters.black, -3, 4);
      characters.orange.eyes.style.left = '60px'; characters.orange.eyes.style.top = '95px'; setPupils(characters.orange, -3, 4);
      characters.yellow.eyes.style.left = '35px'; characters.yellow.eyes.style.top = '45px'; setPupils(characters.yellow, -3, 4); characters.yellow.mouth.style.left = '30px'; characters.yellow.mouth.style.top = '92px'; characters.yellow.mouth.style.transform = 'rotate(-8deg)';
    } else if (lookingAway) {
      characters.purple.eyes.style.left = '20px'; characters.purple.eyes.style.top = '25px'; setPupils(characters.purple, -5, -5);
      characters.black.eyes.style.left = '10px'; characters.black.eyes.style.top = '20px'; setPupils(characters.black, -4, -5);
      characters.orange.eyes.style.left = '50px'; characters.orange.eyes.style.top = '75px'; setPupils(characters.orange, -5, -5);
      characters.yellow.eyes.style.left = '20px'; characters.yellow.eyes.style.top = '30px'; setPupils(characters.yellow, -5, -5); characters.yellow.mouth.style.left = '15px'; characters.yellow.mouth.style.top = '78px'; characters.yellow.mouth.style.transform = 'rotate(0deg)';
    } else if (pwdVisible) {
      characters.purple.eyes.style.left = '20px'; characters.purple.eyes.style.top = '35px'; setPupils(characters.purple, showPassword ? 4 : -4, showPassword ? 5 : -4);
      characters.black.eyes.style.left = '10px'; characters.black.eyes.style.top = '28px'; setPupils(characters.black, -4, -4);
      characters.orange.eyes.style.left = '50px'; characters.orange.eyes.style.top = '85px'; setPupils(characters.orange, -5, -4);
      characters.yellow.eyes.style.left = '20px'; characters.yellow.eyes.style.top = '35px'; setPupils(characters.yellow, -5, -4); characters.yellow.mouth.style.left = '10px'; characters.yellow.mouth.style.top = '88px'; characters.yellow.mouth.style.transform = 'rotate(0deg)';
    } else if (isLookingAtEachOther) {
      characters.purple.eyes.style.left = '55px'; characters.purple.eyes.style.top = '65px'; setPupils(characters.purple, 3, 4);
      characters.black.eyes.style.left = '32px'; characters.black.eyes.style.top = '12px'; setPupils(characters.black, 0, -4);
      characters.orange.eyes.style.left = '82px'; characters.orange.eyes.style.top = '90px'; setPupils(characters.orange, 3, 4);
      characters.yellow.eyes.style.left = '52px'; characters.yellow.eyes.style.top = '40px'; setPupils(characters.yellow, 3, 4); characters.yellow.mouth.style.left = '40px'; characters.yellow.mouth.style.top = '88px'; characters.yellow.mouth.style.transform = 'rotate(0deg)';
    } else {
      for (const character of [characters.purple, characters.black, characters.orange, characters.yellow]) {
        const next = position(character);
        character.eyes.style.left = `${character.baseX + next.faceX}px`;
        character.eyes.style.top = `${character.baseY + next.faceY}px`;
        const offset = pupil(character, character.pupilL, character.max);
        if (offset) setPupils(character, offset.x, offset.y);
      }
      characters.yellow.mouth.style.left = `${40 + yellowPosition.faceX}px`;
      characters.yellow.mouth.style.top = `${88 + yellowPosition.faceY}px`;
      characters.yellow.mouth.style.transform = 'rotate(0deg)';
    }
  }
  function setTyping(value) {
    isTyping = value;
    isLookingAtEachOther = value;
    clearTimeout(typingTimer);
    if (value) typingTimer = setTimeout(() => { isLookingAtEachOther = false; update(); }, 800);
    update();
  }
  function blink(character) {
    character.value = true;
    update();
    setTimeout(() => { character.value = false; update(); schedule(character); }, 150);
  }
  function schedule(character) { setTimeout(() => blink(character), Math.random() * 4000 + 3000); }
  function triggerError() {
    clearTimeout(errorTimer);
    isLoginError = true;
    error.classList.add('is-visible');
    error.textContent = '请输入完整的服务器密钥、账户名和密码。';
    scene.classList.remove('is-error');
    void scene.offsetHeight;
    scene.classList.add('is-error');
    update();
    errorTimer = setTimeout(() => { isLoginError = false; error.classList.remove('is-visible'); scene.classList.remove('is-error'); update(); }, 2500);
  }
  toggle?.addEventListener('click', () => { showPassword = !showPassword; password.type = showPassword ? 'text' : 'password'; toggle.textContent = showPassword ? '○' : '◉'; update(); });
  document.addEventListener('mousemove', (event) => { mouseX = event.clientX; mouseY = event.clientY; if (!isTyping && !isLoginError) update(); });
  [serverKey, username].forEach((input) => { input.addEventListener('focus', () => setTyping(true)); input.addEventListener('blur', () => setTyping(false)); input.addEventListener('input', update); });
  password.addEventListener('focus', () => { isPasswordFocused = true; update(); });
  password.addEventListener('blur', () => { isPasswordFocused = false; update(); });
  password.addEventListener('input', update);
  form.addEventListener('submit', () => { if (!serverKey.value.trim() || !username.value.trim() || !password.value) triggerError(); });
  schedule({ get value() { return purpleBlinking; }, set value(value) { purpleBlinking = value; } });
  schedule({ get value() { return blackBlinking; }, set value(value) { blackBlinking = value; } });
  window.marketLoginCharacters = { triggerError };
  update();
}());
