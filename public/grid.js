/* Shared helpers for 8x8 board games (chess, checkers). */
(function (root) {
  const Grid = {
    // Builds the 64 squares. cell(sq, r, f) -> { cls, inner }
    html(bottom, cell) {
      const flip = bottom === 'b';
      let h = '';
      for (let i = 0; i < 64; i++) {
        const row = i >> 3, col = i & 7, r = flip ? row : 7 - row, f = flip ? 7 - col : col, sq = r * 8 + f;
        const c = cell(sq, r, f) || {};
        h += `<div class="sq ${(r + f) % 2 === 0 ? 'd' : 'l'} ${c.cls || ''}" data-sq="${sq}">` +
          (col === 0 ? `<span class="co r">${r + 1}</span>` : '') +
          (row === 7 ? `<span class="co f">${'abcdefgh'[f]}</span>` : '') + (c.inner || '') + '</div>';
      }
      return h;
    },

    // Click + drag handling. h = { active(), press(sq) -> sq to drag | null, drop(from, to) }
    bind(el, h) {
      let drag = null;
      el.addEventListener('pointerdown', e => {
        const s = e.target.closest('.sq');
        if (!s || !h.active()) return;
        const from = h.press(+s.dataset.sq);
        if (from === null || from === undefined) return;
        const pc = el.querySelector(`.sq[data-sq="${from}"] .pc`);
        if (!pc) return;
        const g = pc.cloneNode(true);
        g.classList.add('ghost');
        g.style.setProperty('--bs', getComputedStyle(document.querySelector('.boardcol')).getPropertyValue('--bs'));
        g.style.left = e.clientX + 'px'; g.style.top = e.clientY + 'px';
        document.body.appendChild(g);
        pc.classList.add('drag');
        drag = { from, g };
      });
      window.addEventListener('pointermove', e => {
        if (drag) { drag.g.style.left = e.clientX + 'px'; drag.g.style.top = e.clientY + 'px'; }
      });
      window.addEventListener('pointerup', e => {
        if (!drag) return;
        const d = drag; drag = null; d.g.remove();
        const t = document.elementFromPoint(e.clientX, e.clientY), sq = t && t.closest && t.closest('.sq');
        if (sq && +sq.dataset.sq !== d.from) h.drop(d.from, +sq.dataset.sq);
        else h.drop(d.from, null);
      });
    },

    // Move list for games with alternating single moves: "1. e4 e5"
    pairList(labels, vi) {
      let h = '';
      for (let i = 0; i < labels.length; i += 2) {
        h += `<span class="n">${i / 2 + 1}.</span><span class="mv ${vi === i + 1 ? 'cur' : ''}" data-v="${i + 1}">${labels[i]}</span>` +
          (labels[i + 1] ? `<span class="mv ${vi === i + 2 ? 'cur' : ''}" data-v="${i + 2}">${labels[i + 1]}</span>` : '<span></span>');
      }
      return h;
    }
  };
  root.Grid = Grid;
  root.Games = root.Games || {};
})(window);
