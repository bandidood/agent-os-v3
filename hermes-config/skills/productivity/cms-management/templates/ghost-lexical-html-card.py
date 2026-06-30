"""
Ghost v5 Lexical HTML Card builder.
Use this when creating/updating Ghost posts with rich HTML content via Admin API.

Ghost v5 ignores the `html` and `mobiledoc` fields on POST/PUT.
You MUST use the `lexical` field with valid Lexical JSON.

Usage:
    from ghost_lexical_html_card import build_lexical_html_card

    lexical = build_lexical_html_card("<p>Hello <strong>world</strong></p>")
    post_data = {
        "posts": [{
            "title": "My Post",
            "lexical": lexical,
            "status": "published",
        }]
    }
"""
import json


def build_lexical_html_card(html_content: str) -> str:
    """Wrap raw HTML in a Ghost v5 Lexical HTML card node.

    Args:
        html_content: Raw HTML string to embed in the post body.

    Returns:
        JSON string of a valid Lexical document containing a single HTML card.

    Note:
        The rendered HTML will be wrapped in <!--kg-card-begin: html--> /
        <!--kg-card-end: html--> comment markers by Ghost. This is normal.
    """
    lexical = {
        "root": {
            "type": "root",
            "format": "",
            "indent": 0,
            "version": 1,
            "children": [
                {
                    "type": "html",
                    "version": 1,
                    "html": html_content
                }
            ],
            "direction": "ltr"
        }
    }
    return json.dumps(lexical)


def build_lexical_paragraph(text: str, bold: bool = False, italic: bool = False) -> dict:
    """Build a single Lexical paragraph node.

    Args:
        text: Plain text content.
        bold: Whether the text is bold.
        italic: Whether the text is italic.

    Returns:
        Lexical paragraph node dict.
    """
    fmt = 0
    if bold:
        fmt |= 1
    if italic:
        fmt |= 2

    return {
        "type": "paragraph",
        "direction": None,
        "format": "",
        "indent": 0,
        "version": 1,
        "children": [
            {"type": "text", "text": text, "format": fmt, "version": 1}
        ]
    }


def build_lexical_heading(text: str, level: int = 2) -> dict:
    """Build a Lexical heading node.

    Args:
        text: Heading text.
        level: Heading level (1-6, default 2).

    Returns:
        Lexical heading node dict.
    """
    tag = f"h{level}"
    return {
        "type": tag,
        "direction": None,
        "format": "",
        "indent": 0,
        "version": 1,
        "children": [
            {"type": "text", "text": text, "format": 0, "version": 1}
        ]
    }


def build_lexical_document(children: list) -> str:
    """Build a complete Lexical document from a list of child nodes.

    Args:
        children: List of Lexical node dicts (paragraphs, headings, html cards, etc.)

    Returns:
        JSON string of a valid Lexical document.
    """
    lexical = {
        "root": {
            "type": "root",
            "format": "",
            "indent": 0,
            "version": 1,
            "children": children,
            "direction": "ltr"
        }
    }
    return json.dumps(lexical)