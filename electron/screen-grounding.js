'use strict';

function screenGrounded(response, description) {
  try {
    const payload = JSON.parse(response);
    const text = payload.choices?.[0]?.message?.content ?? payload.content?.filter(part => part.type === 'text').map(part => part.text).join('');
    const json = typeof text === 'string' && text.match(/\{[\s\S]*\}/u);
    if (!json) return false;
    const { reply, screenDetail } = JSON.parse(json[0]);
    if (typeof reply !== 'string' || typeof screenDetail !== 'string') return false;
    const normalize = value => value.normalize('NFKC').toLowerCase().trim().replace(/\s+/gu, ' ');
    const detail = normalize(screenDetail);
    if (detail.length > 64 || !/(?:\p{Script=Han}{2,}|[a-z]{4,})/u.test(detail) || /^(?:画面|屏幕|文字|图片|screen|image|text)$/u.test(detail)) return false;
    return normalize(description).includes(detail) && normalize(reply.trim().slice(0, 100)).includes(detail);
  } catch (_) { return false; }
}

module.exports = { screenGrounded };
