# The control system every candidate shows

PROTOTYPE (throwaway). One system, three tools.

- **Plant (open loop):** G(s) = K / (s(s + 2)), gain K set by the student.
- **Loop:** unity negative feedback, H(s) = 1.
- **Closed loop:** T(s) = K / (s² + 2s + K), so ωn = √K and ζ = 1/√K.

## Key values at K = 4

Verified with python-control 0.10.2 (research note, section 5; re-run here in a scratch venv).

| Quantity | Value |
|---|---|
| Closed loop T(s) | 4 / (s² + 2s + 4) |
| Closed-loop poles | −1 ± 1.732051j |
| ωn, ζ | 2 rad/s, 0.5 |
| Percent overshoot | 16.30 % |
| Phase margin | 51.83° at ωgc = 1.5723 rad/s |
| Gain margin | ∞ (phase never reaches −180°) |
| Settling time, textbook 4/(ζωn) | 4.0 s |
| Settling time, 2 % band on a 0.1 ms grid (python-control `step_info`) | 4.038 s |

The pages show the textbook 4/(ζωn) as "Ts" and draw the true 2 % band on the plot, because the
two differ (4.0 s against 4.04 s). A real build must pin the Professor's convention.
