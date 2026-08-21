"""Adapters that bridge the database to pure, side-effect-free engines.

``app.match`` (the kashrut gate + fit score) never imports the database, settings or
a clock. Modules in this package are the only place ORM rows and API request schemas
are translated into that engine's plain input types — the boundary lives here, not
inside ``app.match``.
"""
