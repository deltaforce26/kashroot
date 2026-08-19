import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
os.chdir(os.path.dirname(__file__))

from sqlalchemy import text

from app.db.session import engine

with engine.connect() as conn:
    # Check distinct city_slug values
    result = conn.execute(text('SELECT DISTINCT city_slug, city_en FROM restaurant ORDER BY city_slug LIMIT 20'))
    print('First city_slug values:')
    for row in result:
        print(f'  slug="{row[0]}" en="{row[1]}"')

    print()

    # Check what city_slug value corresponds to Jerusalem
    result = conn.execute(text("SELECT DISTINCT city_slug FROM restaurant WHERE city_en ILIKE '%Jerusalem%' ORDER BY city_slug"))
    print('Jerusalem city_slug values:')
    for row in result:
        print(f'  "{row[0]}"')
