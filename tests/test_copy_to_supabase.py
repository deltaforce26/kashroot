"""Guards on the Supabase data-copy script.

The copy restores raw rows table by table, so foreign-key ordering is the whole
correctness story: a child table restored before its parent aborts the transaction
partway through. That order is derived from ``Base.metadata.sorted_tables`` rather
than hand-maintained, and this asserts the derivation actually holds for every
foreign key in the schema.

Nothing here needs Docker or a database.
"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

import app.models  # noqa: F401  registers every table on Base.metadata
from app.db.base import Base

SCRIPT_PATH = Path(__file__).resolve().parent.parent / "scripts" / "copy_to_supabase.py"


def load_script():
    """
    Import the copy script by path.

    ``scripts/`` is not a package, so the module is loaded directly rather than
    imported by name.

    Return:
        ModuleType: The loaded ``copy_to_supabase`` module.
    """
    spec = importlib.util.spec_from_file_location("copy_to_supabase", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    return module


copy_to_supabase = load_script()


class TableOrderTests(unittest.TestCase):
    def test_every_parent_table_is_restored_before_its_children(self) -> None:
        """A child restored before its parent aborts the whole restore transaction."""
        order = copy_to_supabase.ordered_tables()
        position = {name: index for index, name in enumerate(order)}

        for table in Base.metadata.tables.values():
            for foreign_key in table.foreign_keys:
                parent = foreign_key.column.table.name
                if parent == table.name:
                    continue
                with self.subTest(child=table.name, parent=parent):
                    self.assertLess(
                        position[parent],
                        position[table.name],
                        f"{parent} must be restored before {table.name}",
                    )

    def test_the_order_covers_every_mapped_table_exactly_once(self) -> None:
        order = copy_to_supabase.ordered_tables()

        self.assertEqual(len(order), len(set(order)))
        self.assertEqual(set(order), set(Base.metadata.tables))

    def test_the_known_demo_critical_tables_are_included(self) -> None:
        """geocode_cache carries the paid Google responses; losing it re-bills them."""
        order = copy_to_supabase.ordered_tables()

        for table in ("restaurant", "certificate", "certifier", "geocode_cache", "audit_log"):
            self.assertIn(table, order)


class SourceUrlTests(unittest.TestCase):
    def test_the_source_is_the_compose_database_not_whatever_env_points_at(self) -> None:
        """.env now points at Supabase; the source must stay the local container."""
        url = copy_to_supabase.local_url()

        self.assertEqual(url.host, "localhost")
        self.assertEqual(url.port, 5433)
        self.assertEqual(url.database, "kashroot")

    def test_the_source_uses_the_psycopg3_driver(self) -> None:
        self.assertEqual(copy_to_supabase.local_url().drivername, "postgresql+psycopg")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
