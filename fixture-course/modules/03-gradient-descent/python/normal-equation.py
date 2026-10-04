# The line through the three points by the normal equation, solved in one step with numpy:
# theta = (X^T X)^-1 X^T y. Change the points or the model and run it again.
import numpy as np

x = np.array([0.0, 1.0, 2.0])
y = np.array([1.0, 3.0, 4.0])

X = np.column_stack([np.ones_like(x), x])  # a column of ones for theta0
theta = np.linalg.solve(X.T @ X, X.T @ y)
cost = np.sum((X @ theta - y) ** 2) / (2 * len(x))

print(f"theta0 = {theta[0]:.4f}")
print(f"theta1 = {theta[1]:.4f}")
print(f"J(theta) = {cost:.4f}")

ends = np.array([0.0, 3.0])
plot = [{"id": f"point-{i + 1}", "kind": "point", "at": [xi, yi]} for i, (xi, yi) in enumerate(zip(x, y))]
plot.append({"id": "fit", "kind": "line", "through": [[e, theta[0] + theta[1] * e] for e in ends]})
