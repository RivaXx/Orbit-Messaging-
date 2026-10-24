# Calculator logic and responsiveness update

The calculator now replaces a pending operator instead of calculating early: 69, +, ×, 2, = returns 138. The previous operand remains visible while an operator is pending.

- Strict expression parser replaces dynamic code execution. Decimal arithmetic uses exact rational values internally; results display 15 significant digits. Scientific functions remain approximate.
- Standard precedence, parentheses, signed operands, right-associative powers, contextual percentages, repeated equals and exact answer carry use one engine for live preview and final results.
- Explicit domain/range errors and recovery; clear-entry preserves pending operations. Scientific functions support saved DEG/RAD mode. Memory operations and keyboard handling are corrected.
- Date arithmetic clamps month ends/leap days and uses calendar days across daylight-saving changes. Conversions retain small values and reject malformed numbers, invalid units and impossible temperatures.
- Mobile scientific keys have larger touch targets. Full-screen light-mode surfaces, control contrast and short input transitions improve usability without animating layout dimensions.

Validation: 168 Node regression tests pass, including 400 deterministic arithmetic comparisons, the reported 69 + → × correction, carry precision, scientific domains, percentages, date edge cases and conversions. Actual browser checks cover mobile light/dark layouts and the corrected button sequence. A local Node measurement completed 10,000 representative expression evaluations in 171 ms; this is an engine measurement, not a mobile frame-rate guarantee.

Release assets: calculator-engine-20261023-r1. No backend migration is required.
