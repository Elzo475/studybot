const cooldowns = new Map();

function canRun(userId, action, seconds) {
    const key = `${userId}:${action}`;
    const now = Date.now();
    const expires = cooldowns.get(key) || 0;

    if (now < expires) {
        return {
            ok: false,
            remaining: Math.ceil((expires - now) / 1000)
        };
    }

    cooldowns.set(key, now + seconds * 1000);
    return { ok: true, remaining: 0 };
}

module.exports = {
    canRun
};
