"""How a read ends when it doesn't succeed; the command line maps each to its exit code."""


class BlankRender(Exception):
    """A page with content rendered to one flat colour: the render can't be trusted. (Exit 1.)"""


class BadInput(Exception):
    """A flag, path or file the reader can't use. (Exit 2.)"""


class Refused(Exception):
    """The reader won't do this: nothing was read or written. (Exit 3.)"""
