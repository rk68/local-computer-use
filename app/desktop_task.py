"""Progress for one desktop request within a guest session."""
from dataclasses import dataclass, field


@dataclass
class DesktopTask:
    goal: str
    epoch: int
    steps: int = 0

    recent_actions: list[str] = field(default_factory=list)
    executed_steps: list[dict] = field(default_factory=list)
    recent_screens: list[str | None] = field(default_factory=list)

    def record(self, fingerprint, receipt=None, screen_digest=None):
        if receipt is not None:
            self.executed_steps.append(receipt)
        self.recent_actions.append(fingerprint)
        self.recent_screens.append(screen_digest)
        if (len(self.recent_actions) >= 3 and len(set(self.recent_actions[-3:])) == 1
                and len(set(self.recent_screens[-3:])) == 1):
            raise ValueError('The same action repeated three times. Task paused; inspect the screenshot before trying again.')

        if (len(self.recent_actions) >= 6 and self.recent_actions[-6:-4] == self.recent_actions[-4:-2] == self.recent_actions[-2:]
                and self.recent_screens[-6:-4] == self.recent_screens[-4:-2] == self.recent_screens[-2:]):
            raise ValueError('The same action cycle repeated three times. Task paused; inspect the screenshot before trying again.')
