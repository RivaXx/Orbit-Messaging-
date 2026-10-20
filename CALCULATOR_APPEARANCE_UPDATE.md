Calculator wallpaper and number controls

Fixed full-screen typography overriding the selected text size. Normal and bold weights now apply to the display and keypad in Classic and Glass themes, in both layouts. Five sizes (XS–XL) have a visible current value and disabled controls at their limits. Narrow keypads scale each size proportionally. Long results shrink to fit.

Wallpaper selection binds its handler even before initialization, decodes via image load events, resizes/compresses photos before saving, accepts supported files with missing MIME metadata, and reports unsupported files or full device storage without replacing the current wallpaper. Reset also cancels an image still loading. Saved wallpaper has separate theme-aware image/overlay layers so it remains visible in light/dark modes and after reopening.

Preferences and wallpaper remain local to this browser/device. No backend migration.

Validation: node --test tests/*.test.cjs (109 passing). Browser checked actual file chooser upload, XS/XL limits, weight 500/800, Classic/Glass, full-screen/normal, light/dark, reload persistence, mobile 360px layout. Updated asset cache version calculator-appearance-20261020-r2.
