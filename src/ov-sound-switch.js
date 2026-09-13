/* <ov-sound-switch> - the one control, remembered.
 *
 * Same pattern as the contrast and motion switches: default off, one
 * control, and the choice survives a reload. It also exposes the per-category
 * mutes, because that is the part that makes the model worth having.
 */

import { define } from './ov-core.js';
import './ov-sound.js';
class OvSoundSwitch extends HTMLElement {
  connectedCallback() {
    if (this.dataset.ready) return;
    this.dataset.ready = '1';
    const cats = (this.getAttribute('categories') || 'ui,alarm,ambient').split(',');
    this.innerHTML =
      `<button class="ov-btn ov-sound__main" aria-pressed="false"><span>sound</span></button>`
      + cats.map((c) => `<label class="ov-check ov-sound__cat">`
        + `<input type="checkbox" data-cat="${c}" checked>${c}</label>`).join('');

    this.main = this.querySelector('.ov-sound__main');
    this.main.addEventListener('click', () => {
      // The gesture is the point: this is where the audio context is allowed
      // to start, and it is why there is no way to turn sound on without one.
      Overscan.sound.enable(!Overscan.sound.state.on);
      Overscan.sound.play('press', this);
    });
    for (const box of this.querySelectorAll('[data-cat]')) {
      box.addEventListener('change', () => {
        Overscan.sound.mute(box.dataset.cat, !box.checked);
        Overscan.sound.play('key', this);
      });
    }
    addEventListener('ov:sound', () => this.sync());
    this.sync();
  }

  sync() {
    const s = Overscan.sound.state;
    this.main.setAttribute('aria-pressed', String(s.on));
    this.toggleAttribute('data-ov-on', s.on);
    for (const box of this.querySelectorAll('[data-cat]')) {
      box.checked = !s.muted[box.dataset.cat];
      box.disabled = !s.on;
    }
  }
}
define('ov-sound-switch', OvSoundSwitch);

export { OvSoundSwitch };
