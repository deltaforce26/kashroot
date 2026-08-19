# Coding Standards — Python (Mandatory)

These standards apply to **Python code only**. Other languages (TypeScript/React
web console, React Native client) are not governed by this document.

## File size
- Maximum **500 lines** per Python file in routers, storage, schemas, and tests.
  If a file exceeds this, refactor into smaller, focused modules.
- Exceptions: generated Alembic migrations, large config data structures.

## No plain strings in code
- All user-facing strings, error messages, log format strings, and magic values
  go in `consts.py` with informative names.
- Connection details and similar config belong in a class inside `consts.py` or
  `config.py`.

## No comments in code
- If logic is complex, explain it in the function's docstring, not in inline
  comments.

## No secrets in codebase or git
- All secrets via environment variables / `.env` (which is gitignored).

## Function signatures
- Every function must have **type annotations** for all parameters and the
  return value.
- Every function must have a **docstring** in this format:

```python
def my_func(param: str) -> int:
    """
    Description of what the function does.

    Parameters:
        param (str): What param is.

    Return:
        int: What is returned.
    """
```

## Return statement formatting
- Add an **empty line before every `return`** statement, unless the `return` is
  directly inside a short `if` block.

## Testing
- Use **unittest** (not pytest style). Test files go in `tests/`.

## Pydantic
- Use Pydantic **field validators** (`field_validator`, `model_validator`) for
  input validation in schemas.

## Performance
- Prefer **vectorized operations** and **`itertools`** over explicit loops where
  applicable.

## Decorators
- Use decorators where they reduce repetition (auth, rate limiting, validation).

## Git branching
- Branch names must use prefixes: `feature/`, `bug/`, `refactor/`, `docs/`, etc.

## Formatting
- Run `ruff format .` and `ruff check . --fix` before committing.
