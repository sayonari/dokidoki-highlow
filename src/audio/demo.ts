import { sfx } from './sfx';

type Item = [string, () => void];

const items: Item[] = [
  ['click up', () => sfx.click('up')],
  ['click down', () => sfx.click('down')],
  ['settleWin 0.1', () => sfx.settleWin(0.1)],
  ['settleWin 0.5', () => sfx.settleWin(0.5)],
  ['settleWin 1', () => sfx.settleWin(1)],
  ['settleLose 0.1', () => sfx.settleLose(0.1)],
  ['settleLose 1', () => sfx.settleLose(1)],
  ['tick', () => sfx.tick()],
  ['reach', () => sfx.reach()],
  ['gekiatsu', () => sfx.gekiatsu()],
  ['jackpot', () => sfx.jackpot()],
  ['coins 10', () => sfx.coins(10)],
  ['coins 40', () => sfx.coins(40)],
  ['bakueki', () => sfx.bakueki()],
  ['losscut', () => sfx.losscut()],
  ['countdown 3', () => sfx.countdown(3)],
  ['countdown 0 (スタート)', () => sfx.countdown(0)],
  ['gameEnd 勝ち', () => sfx.gameEnd(true)],
  ['gameEnd 負け', () => sfx.gameEnd(false)],
  ['BGM normal', () => sfx.bgmStart('normal')],
  ['BGM kakuhen', () => sfx.bgmStart('kakuhen')],
  ['BGM stop', () => sfx.bgmStop()],
  ['voice 大当たり！', () => sfx.voice('大当たり！')],
  ['voice 激アツ！', () => sfx.voice('激アツ！')],
];

const root = document.getElementById('buttons');
if (root) {
  for (const [label, fn] of items) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => {
      sfx.unlock();
      fn();
    });
    root.appendChild(b);
  }
}

document.getElementById('vol')?.addEventListener('input', (e) => {
  sfx.setVolume(Number((e.target as HTMLInputElement).value));
});
document.getElementById('en')?.addEventListener('change', (e) => {
  sfx.setEnabled((e.target as HTMLInputElement).checked);
});
document.getElementById('vo')?.addEventListener('change', (e) => {
  sfx.setVoiceEnabled((e.target as HTMLInputElement).checked);
});
