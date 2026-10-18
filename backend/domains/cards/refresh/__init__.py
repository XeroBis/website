"""Catalog refresh pipeline (admin-triggered): the HTML import from
CARDS_SOURCE_DIR, then downloads into CARDS_DATA_DIR (scans, thumbnails, set
logos/symbols, variant badges, TCGdex text). jobs.py runs the steps in a
background thread and keeps their progress in memory."""
