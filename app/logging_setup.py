"""Bounded diagnostic logs, without chat messages or screenshots."""
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path


def configure():
    logger = logging.getLogger('holo.poc')
    if not logger.handlers:
        folder = Path(__file__).resolve().parents[1] / 'logs'
        folder.mkdir(exist_ok=True)
        handler = RotatingFileHandler(folder / 'poc.log', maxBytes=2_000_000, backupCount=2)
        handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False
    return logger
