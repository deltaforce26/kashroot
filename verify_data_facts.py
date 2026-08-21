import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
os.chdir(os.path.dirname(__file__))

from sqlalchemy import text

from app.db.session import engine

with engine.connect() as conn:
    # 1. Check certifier count
    result = conn.execute(text('SELECT COUNT(*) FROM certifier WHERE is_active'))
    cert_count = result.scalar()
    print(f"1. Certifiers (active): {cert_count} (expect 4)")

    # 2. Check Jerusalem geocoded coverage
    result = conn.execute(text("""
        SELECT
            COUNT(*) as total,
            COUNT(CASE WHEN geo IS NOT NULL THEN 1 END) as geocoded
        FROM restaurant
        WHERE city_en = 'Jerusalem'
    """))
    total, geocoded = result.first()
    coverage = (geocoded / total * 100) if total > 0 else 0
    print(f"2. Jerusalem geocoded: {geocoded}/{total} = {coverage:.1f}% (expect ~70.7%, 99/140)")

    # 3. Check Bayit VeGan coverage
    result = conn.execute(text("""
        SELECT
            COUNT(*) as total,
            COUNT(CASE WHEN geo IS NOT NULL THEN 1 END) as geocoded
        FROM restaurant
        WHERE neighborhood_he LIKE '%ביתוגן%' OR neighborhood_he = 'ביית וגן'
    """))
    total, geocoded = result.first()
    if total and total > 0:
        coverage = geocoded / total * 100
        print(f"3. Bayit VeGan geocoded: {geocoded}/{total} = {coverage:.1f}% (expect 100%, 6/6)")
    else:
        print("3. Bayit VeGan: no records found or may need different query")

    # 4. Check certificate freshness (365-day window)
    now = dt.datetime.now(dt.UTC)
    fresh_cutoff = now - dt.timedelta(days=365)
    result = conn.execute(text("""
        SELECT
            COUNT(CASE WHEN verified_at >= :cutoff THEN 1 END) as fresh,
            COUNT(CASE WHEN verified_at < :cutoff THEN 1 END) as stale
        FROM certificate
    """), {"cutoff": fresh_cutoff})
    fresh, stale = result.first()
    print(f"4. Certificate freshness (365-day window): {fresh} fresh / {stale} stale (expect 540 fresh / 0 stale)")

    # 5. Check freshness-fresh but expired certificates
    result = conn.execute(text("""
        SELECT COUNT(*) FROM certificate
        WHERE verified_at >= :cutoff AND valid_until IS NOT NULL AND valid_until < CURRENT_DATE
    """), {"cutoff": fresh_cutoff})
    expired_fresh = result.scalar()
    print(f"5. Freshness-fresh but expired certs: {expired_fresh} (expect 2)")

    # 6. Total certificate count
    result = conn.execute(text('SELECT COUNT(*) FROM certificate'))
    cert_total = result.scalar()
    print(f"6. Total certificates: {cert_total} (expect 540)")

    # 7. Total restaurant count
    result = conn.execute(text('SELECT COUNT(*) FROM restaurant'))
    rest_total = result.scalar()
    print(f"7. Total restaurants: {rest_total} (expect 531)")
