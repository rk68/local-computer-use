"""Guest action contracts and coordinate conversion."""
import copy

KEYS = {'enter', 'tab', 'shift+tab', 'escape', 'backspace', 'delete',
        'up', 'down', 'left', 'right', 'space', 'ctrl+a', 'ctrl+l'}
COORDINATES = {
    'x': {'type': 'integer', 'minimum': 0, 'maximum': 1000,
          'description': 'Horizontal position normalized across the screenshot'},
    'y': {'type': 'integer', 'minimum': 0, 'maximum': 1000,
          'description': 'Vertical position normalized across the screenshot'},
}
ACTION_FIELDS = {
    'navigate': {'url': {'type': 'string', 'description': 'A public HTTPS website URL'}},
    'click': COORDINATES,
    'type': {'text': {'type': 'string'}},
    'replace_text': {**COORDINATES, 'text': {'type': 'string', 'description': 'The complete new field value'}},
    'key': {'key': {'type': 'string', 'enum': sorted(KEYS)}},
    'scroll': {**COORDINATES, 'direction': {'type': 'string', 'enum': ['up', 'down']}},
}
TOOL_ACTIONS = {f'desktop_{action}': action for action in ACTION_FIELDS}
TOOLS = [
    {'type': 'function', 'function': {
        'name': name,
        'description': (
            'Click the target text field, select its contents, and type the new value. Requires user approval.'
            if action == 'replace_text' else f'Propose a {action} action inside the practice VM for user approval.'
        ),
        'parameters': {
            'type': 'object',
            'additionalProperties': False,
            'properties': {**ACTION_FIELDS[action], 'reason': {'type': 'string'}},
            'required': [*ACTION_FIELDS[action], 'reason'],
        },
    }} for name, action in TOOL_ACTIONS.items()
]
TOOLS.append({'type': 'function', 'function': {
    'name': 'desktop_reply',
    'description': 'Answer a question, describe the screenshot, or report a completed task.',
    'parameters': {
        'type': 'object', 'additionalProperties': False,
        'properties': {'text': {'type': 'string'}}, 'required': ['text'],
    },
}})


def validate_action(action, width, height):
    """Fail closed: no shell, arbitrary methods, extra fields, or out-of-bounds input."""
    if not isinstance(action, dict):
        raise ValueError('Action must be an object.')
    kind = action.get('action')
    if (not isinstance(kind, str) or kind not in ACTION_FIELDS
            or set(action) != set(ACTION_FIELDS[kind]) | {'action', 'reason'}):
        raise ValueError('Unsupported action or unexpected action fields.')
    if not isinstance(action['reason'], str) or not 1 <= len(action['reason']) <= 1000:
        raise ValueError('Action needs a short reason.')
    if 'x' in ACTION_FIELDS[kind]:
        for axis, maximum in [('x', width), ('y', height)]:
            if type(action[axis]) is not int or not 0 <= action[axis] < maximum:
                raise ValueError('Coordinates must lie inside the guest screenshot.')
    if kind == 'navigate':
        from app.credential_vault import website_origin
        website_origin(action['url'])
    if 'text' in ACTION_FIELDS[kind]:
        text = action['text']
        if not isinstance(text, str) or not 1 <= len(text) <= 500 or any(ord(c) < 32 or ord(c) == 127 for c in text):
            raise ValueError('Typing accepts 1–500 characters without control characters.')
    if kind == 'key' and (not isinstance(action['key'], str) or action['key'] not in KEYS):
        raise ValueError('That key combination is not allowed.')
    if kind == 'scroll' and action['direction'] not in ('up', 'down'):
        raise ValueError('Scroll direction must be up or down.')
    return copy.deepcopy(action)


def model_action_in_pixels(arguments, width, height):
    if isinstance(arguments, dict) and arguments.get('action') in ('click', 'scroll', 'replace_text'):
        arguments = dict(arguments)
        for axis, size in [('x', width), ('y', height)]:
            coordinate = arguments.get(axis)
            if type(coordinate) is not int or not 0 <= coordinate <= 1000:
                raise ValueError('Halo must return screenshot coordinates between 0 and 1000.')
            arguments[axis] = min(size - 1, coordinate * size // 1000)
    return validate_action(arguments, width, height)


LOGIN_TOOL = {'type': 'function', 'function': {
    'name': 'desktop_request_login',
    'description': 'Ask the user to privately fill login fields on the current website. Never ask for secrets in chat.',
    'parameters': {'type': 'object', 'additionalProperties': False,
                   'properties': {'reason': {'type': 'string'}}, 'required': ['reason']},
}}

TOOLS.append({'type': 'function', 'function': {
    'name': 'desktop_blocked',
    'description': 'Report an incomplete task, missing target, or obstacle. Do not claim success.',
    'parameters': {'type': 'object', 'additionalProperties': False,
                   'properties': {'text': {'type': 'string'}}, 'required': ['text']},
}})
