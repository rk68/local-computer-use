"""Progress for one desktop request within a guest session."""
from dataclasses import dataclass, field


@dataclass
class DesktopTask:
    goal: str
    epoch: int
    steps: int = 0

    recent_actions: list[str] = field(default_factory=list)

    def record(self, fingerprint):
        self.recent_actions.append(fingerprint)
        if len(self.recent_actions) >= 3 and len(set(self.recent_actions[-3:])) == 1:
            raise ValueError('The same action repeated three times. Task paused; inspect the screenshot before trying again.')
