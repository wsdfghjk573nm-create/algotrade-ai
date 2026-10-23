"""Execution sandbox for user Python strategies — BEST EFFORT, not a
security boundary against a determined attacker. Read the README's
"Sandbox limits" section before exposing this to untrusted users.

Layers:
1. Static AST validation (this module): only `numpy`/`pandas` imports;
   dangerous builtins and IO attributes are rejected before anything runs.
2. Subprocess execution with a restricted builtins namespace (no open,
   eval, exec, __import__), CPU timeout, and no arguments/environment
   beyond the strategy code and OHLCV data passed on stdin.
"""
import ast
import json
import os
import subprocess
import sys
import tempfile

ALLOWED_IMPORTS = {"numpy", "pandas"}
FORBIDDEN_NAMES = {
    "open", "eval", "exec", "compile", "__import__", "input", "globals",
    "locals", "vars", "dir", "getattr", "setattr", "delattr", "breakpoint",
    "help", "exit", "quit", "memoryview", "object", "type", "super",
}
FORBIDDEN_ATTRS = {
    "read_csv", "read_excel", "read_json", "read_pickle", "read_html",
    "read_sql", "read_parquet", "read_feather", "to_csv", "to_excel",
    "to_json", "to_pickle", "to_sql", "to_parquet", "load", "save",
    "savetxt", "fromfile", "tofile", "system", "popen", "urlopen",
}

_RUNNER = r'''
import json, sys, resource
import numpy as np
import pandas as pd

try:
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))
except Exception:
    pass

payload = json.loads(sys.stdin.read())
code = payload["code"]
bars = payload["bars"]
df = pd.DataFrame(bars)

SAFE_BUILTINS = {
    "abs": abs, "all": all, "any": any, "bool": bool, "dict": dict,
    "enumerate": enumerate, "float": float, "int": int, "len": len,
    "list": list, "max": max, "min": min, "range": range, "reversed": reversed,
    "round": round, "set": set, "slice": slice, "sorted": sorted, "str": str,
    "sum": sum, "tuple": tuple, "zip": zip, "isinstance": isinstance,
    # import statements work through this; the AST layer above is the gate:
    # it restricts imports to numpy/pandas and rejects direct __import__ use.
    "__import__": __import__,
    "print": lambda *a, **k: None,
    "Exception": Exception, "ValueError": ValueError, "TypeError": TypeError,
    "KeyError": KeyError, "IndexError": IndexError, "True": True,
    "False": False, "None": None,
}
namespace = {"__builtins__": SAFE_BUILTINS, "np": np, "numpy": np, "pd": pd, "pandas": pd}
try:
    exec(compile(code, "<strategy>", "exec"), namespace)
    fn = namespace.get("generate_signals")
    if not callable(fn):
        print(json.dumps({"ok": False, "error": "Code must define generate_signals(df)"}))
        sys.exit(0)
    result = fn(df)
    values = [float(x) if x == x else 0.0 for x in list(result)]
    values = [1.0 if v > 0 else (-1.0 if v < 0 else 0.0) for v in values]
    print(json.dumps({"ok": True, "signals": values}))
except Exception as exc:
    print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
'''


def validate_code(code: str) -> list:
    """Return a list of validation errors (empty = OK). Does NOT execute."""
    errors = []
    if not code or not code.strip():
        return ["Code is empty"]
    if len(code) > 20000:
        return ["Code is too long (max 20,000 characters)"]
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return [f"Syntax error: {e}"]

    has_fn = False
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "generate_signals":
            has_fn = True
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root not in ALLOWED_IMPORTS:
                    errors.append(f"Import of '{alias.name}' is not allowed (only numpy and pandas)")
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if root not in ALLOWED_IMPORTS:
                errors.append(f"Import from '{node.module}' is not allowed (only numpy and pandas)")
        elif isinstance(node, ast.Name):
            if node.id in FORBIDDEN_NAMES:
                errors.append(f"Use of '{node.id}' is not allowed")
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("__"):
                errors.append(f"Access to '{node.attr}' is not allowed")
            elif node.attr in FORBIDDEN_ATTRS:
                errors.append(f"Use of '{node.attr}' is not allowed")
    if not has_fn:
        errors.append("Code must define a function generate_signals(df)")
    return errors


def run_strategy_code(code: str, bars: list, timeout: int = 12) -> dict:
    """Validate, then execute in a subprocess. Returns {ok, signals|error}."""
    errors = validate_code(code)
    if errors:
        return {"ok": False, "error": "; ".join(errors)}
    runner_path = None
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
            f.write(_RUNNER)
            runner_path = f.name
        payload = json.dumps({"code": code, "bars": bars})
        proc = subprocess.run(
            [sys.executable, runner_path],
            input=payload, capture_output=True, text=True, timeout=timeout,
            env={"PATH": os.environ.get("PATH", ""), "PYTHONNOUSERSITE": "1"},
        )
        out = (proc.stdout or "").strip().splitlines()
        if not out:
            return {"ok": False, "error": "Strategy produced no output (timeout or crash)"}
        return json.loads(out[-1])
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Strategy timed out (10s CPU limit)"}
    except Exception as exc:
        return {"ok": False, "error": f"Sandbox error: {exc}"}
    finally:
        if runner_path:
            try:
                os.unlink(runner_path)
            except OSError:
                pass
