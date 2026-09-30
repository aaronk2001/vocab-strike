# Vocab Strike

A typing game for learning technical vocabulary. Ships fly in carrying a term;
type the term to shoot the ship down. After each wave you type the definition
of every term you shot.

It plays like [ZType](https://zty.pe/), with a second study phase added. The
built-in decks cover industrial controls, machine learning and computer vision,
and electrical and mechanical engineering. You can add your own words.

![Defend phase](assets/defend.png)
![Decode phase](assets/decode.png)

## Play

Clone the repo and open `index.html` in a browser. It is plain HTML and
JavaScript with no dependencies, so it runs straight from the file.

## How it works

Each wave has two phases.

1. **Defend.** Ships move toward you from the right, each labelled with a
   term. Type a term to destroy its ship. A ship that reaches you costs one
   hull point, and the run ends when your hull is gone.
2. **Decode.** Once the wave is clear, you get the definition of each term from
   that wave. Type each one before its timer runs out. Finishing early earns a
   speed bonus. A missed or skipped definition scores nothing and resets your
   combo, but doesn't cost hull.

Waves get faster and bigger as you go, from 3 ships up to 5.

Rules:

- Case doesn't matter. `4-20 ma` counts as `4-20 mA`.
- Once you type the first letter of a term, you are locked onto that ship until
  it's destroyed.
- A wrong key costs accuracy, resets your combo, and freezes the word. Press
  Backspace to clear the mistake and keep typing.
- Every 15 correct keys in a row raises the score multiplier, up to ×5.

| Key | Action |
|---|---|
| `Enter` | Start or restart a run; skip a definition during Decode |
| `Esc` | Pause or resume; back to the menu from the results screen |
| `Backspace` | Clear a mistake |
| `Q` | Quit to the menu while paused |
| `M` | Mute, from the menu or pause screen only |

## Difficulty

| | Ship speed | Definition timer | Hull |
|---|---|---|---|
| Cadet | 70% | 145% | 5 |
| Operator | 100% | 100% | 3 |
| Vanguard | 145% | 76% | 2 |

The base timer is 6 seconds plus 0.25 seconds per character. A 140-character
definition gets 41 seconds on Operator, 59 on Cadet and 31 on Vanguard.

## Decks

| Deck | Terms |
|---|---|
| All systems | 286 |
| ML / CV | 157 |
| EE + Mech | 86 |
| Controls | 43 |
| My words | whatever you add |

Symbols are written out as plain ASCII so everything can be typed on a US
keyboard. The Decode screen still shows the original notation after you finish.

| Source | You type |
|---|---|
| `P = V·I·cosφ` | `P = V*I*cos phi` |
| `Z = √(R² + (XL - Xc)²)` | `Z = sqrt(R^2 + (XL - Xc)^2)` |
| `Timer Off-Delay — output stays on` | `Timer Off-Delay - output stays on` |

## Adding your own words

Click **+ Add words** on the menu. Enter a term and a definition; the preview
shows exactly what you will have to type. The formula field is optional and is
only displayed, never typed.

Your words always appear in **My words** and **All systems**. If you pick
another deck for a word, it shows up there too. They are saved in your
browser's local storage, so they stay between sessions but only on that
browser.

**Export JSON** saves your list to a file. **Import JSON** loads one back and
skips any term you already have. Import accepts the exported file or a plain
array like this:

```json
[
  { "term": "backlash", "definition": "Lost motion caused by clearance between gear teeth" },
  { "term": "PID", "definition": "Controller that acts on proportional, integral and derivative error", "deck": "controls" }
]
```

`deck` is optional: `mine` (default), `controls`, `ml` or `mech`.

## Files

```
index.html      markup and styles
game.js         game loop, input, rendering, sound
words.js        custom word storage, import and export
data.js         built-in word list (generated)
build_data.py   regenerates data.js
test/           word list audit and a headless Chrome play-through
```

`data.js` is generated from the glossary in Ascent, a separate private project,
and is committed so the game works without it. With an Ascent checkout, set
`ASCENT_DIR` and run `python build_data.py` using Ascent's Python environment.

## License

MIT. See [LICENSE](LICENSE).
