"""Progress for one desktop request within a guest session."""
from dataclasses import dataclass


@dataclass
class DesktopTask:
    goal: str
    epoch: int
    steps: int = 0
