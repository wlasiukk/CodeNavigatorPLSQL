'use strict';

/** Minimal glob -> RegExp (supports **, *, ?, {a,b}); matched against '/'-separated paths. */
function globToRegExp(glob) {
    let re = '';
    let inGroup = false;
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') {
                i++;
                if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
            } else re += '[^/]*';
        } else if (c === '?') re += '[^/]';
        else if (c === '{') { inGroup = true; re += '(?:'; }
        else if (c === '}' && inGroup) { inGroup = false; re += ')'; }
        else if (c === ',' && inGroup) re += '|';
        else re += c.replace(/[.+^$()|[\]\\]/, '\\$&');
    }
    return new RegExp('(?:^|/)' + re + '$', 'i');
}

module.exports = { globToRegExp };
