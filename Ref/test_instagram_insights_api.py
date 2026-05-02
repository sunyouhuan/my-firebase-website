#!/usr/bin/env python3
"""Small Instagram Insights API test tool.

Usage examples:
  python Ref/test_instagram_insights_api.py \
    --metric reach \
    --period day \
    --metric-type total_value \
    --since 2026-04-01 \
    --until 2026-04-30

  python Ref/test_instagram_insights_api.py \
    --metric views \
    --period lifetime \
    --media-id <IG_MEDIA_ID>

Environment variables:
  IG_ACCESS_TOKEN or ACCESS_TOKEN (required)
  IG_USER_ID (required unless --media-id is used)
  IG_MEDIA_ID (optional)
  IG_API_VERSION (optional, default: v23.0)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Dict, Optional
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

try:
    import tkinter as tk
    from tkinter import ttk
except Exception:  # pragma: no cover
    tk = None
    ttk = None

GRAPH_BASE = "https://graph.facebook.com"

# Account Metrics (use with IG User ID)
ACCOUNT_METRICS = [
    "accounts_engaged",
    "comments",
    "engaged_audience_demographics",
    "follower_demographics",
    "follows_and_unfollows",
    "likes",
    "profile_links_taps",
    "reach",
    "replies",
    "reposts",
    "saves",
    "shares",
    "total_interactions",
    "views",
]

# Media Metrics (use with Media ID)
MEDIA_METRICS = [
    "comments",
    "crossposted_views",
    "facebook_views",
    "follows",
    "ig_reels_avg_watch_time",
    "ig_reels_video_view_total_time",
    "likes",
    "navigation",
    "profile_activity",
    "profile_visits",
    "reach",
    "reels_skip_rate",
    "replies",
    "reposts",
    "saved",
    "shares",
    "total_interactions",
    "views",
]

METRIC_TYPE_OPTIONS = ["", "total_value", "time_series"]
TIMEFRAME_OPTIONS = ["", "last_14_days", "last_30_days", "last_90_days", "this_week", "this_month", "prev_month"]
BREAKDOWN_OPTIONS = [
    "media_product_type",
    "follow_type",
    "contact_button_type",
    "story_navigation_action_type",
    "action_type",
    "follower_type",
]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Test Instagram Insights API")
    parser.add_argument("--metric", help="Metric name(s), comma-separated")
    parser.add_argument("--period", help="Period value, e.g. day or lifetime")
    parser.add_argument("--metric-type", help="Metric type, e.g. total_value or time_series")
    parser.add_argument("--since", help="Start date (YYYY-MM-DD)")
    parser.add_argument("--until", help="End date (YYYY-MM-DD)")
    parser.add_argument("--timeframe", help="Predefined window, e.g. last_30_days")
    parser.add_argument("--breakdown", help="Breakdown dimension(s), comma-separated")
    parser.add_argument("--media-id", help="IG media ID (if testing media insights)")
    parser.add_argument("--ig-user-id", help="IG user ID (if testing account insights)")
    parser.add_argument("--access-token", help="Graph API access token")
    parser.add_argument("--api-version", default=os.getenv("IG_API_VERSION", "v25.0"))
    parser.add_argument("--gui", action="store_true", help="Launch simple GUI mode")
    parser.add_argument(
        "--show-url",
        action="store_true",
        help="Print request URL with hidden token",
    )
    return parser


def first_non_empty(*values: Optional[str]) -> Optional[str]:
    for value in values:
        if value:
            return value
    return None


def build_endpoint(api_version: str, media_id: Optional[str], ig_user_id: Optional[str]) -> str:
    if media_id:
        return f"{GRAPH_BASE}/{api_version}/{media_id}/insights"
    if ig_user_id:
        return f"{GRAPH_BASE}/{api_version}/{ig_user_id}/insights"
    raise ValueError("Need --media-id or --ig-user-id/IG_USER_ID")


def build_params(args: argparse.Namespace, token: str) -> Dict[str, str]:
    params: Dict[str, str] = {
        "metric": args.metric,
        "access_token": token,
    }

    optional_map = {
        "period": args.period,
        "metric_type": args.metric_type,
        "since": args.since,
        "until": args.until,
        "timeframe": args.timeframe,
        "breakdown": args.breakdown,
    }

    for key, value in optional_map.items():
        if value:
            params[key] = value

    return params


def hidden_url(endpoint: str, params: Dict[str, str]) -> str:
    safe_params = dict(params)
    if "access_token" in safe_params:
        safe_params["access_token"] = "<HIDDEN>"
    return f"{endpoint}?{urlencode(safe_params)}"


def call_api(endpoint: str, params: Dict[str, str]) -> dict:
    url = f"{endpoint}?{urlencode(params)}"
    request = Request(url, method="GET")
    with urlopen(request, timeout=30) as response:
        payload = response.read().decode("utf-8")
        return json.loads(payload)


def run_cli(args: argparse.Namespace) -> int:
    if not args.metric:
        print("Missing metric: provide --metric")
        return 2

    token = first_non_empty(args.access_token, os.getenv("IG_ACCESS_TOKEN"), os.getenv("ACCESS_TOKEN"))
    if not token:
        print("Missing token: provide --access-token or set IG_ACCESS_TOKEN/ACCESS_TOKEN")
        return 2

    ig_user_id = first_non_empty(args.ig_user_id, os.getenv("IG_USER_ID"))
    media_id = first_non_empty(args.media_id, os.getenv("IG_MEDIA_ID"))

    try:
        endpoint = build_endpoint(args.api_version, media_id, ig_user_id)
    except ValueError as err:
        print(str(err))
        return 2

    params = build_params(args, token)

    if args.show_url:
        print(hidden_url(endpoint, params))

    try:
        data = call_api(endpoint, params)
    except HTTPError as err:
        body = err.read().decode("utf-8", errors="replace")
        print(f"HTTPError {err.code}: {err.reason}")
        print(body)
        return 1
    except URLError as err:
        print(f"URLError: {err.reason}")
        return 1
    except json.JSONDecodeError as err:
        print(f"Failed to parse JSON response: {err}")
        return 1

    print(json.dumps(data, indent=2, ensure_ascii=False))
    return 0


def launch_gui(default_api_version: str) -> int:
    if tk is None or ttk is None:
        print("Tkinter is not available in this Python environment.")
        return 2

    root = tk.Tk()
    root.title("Instagram Insights API Tester")
    root.geometry("980x820")

    main = ttk.Frame(root, padding=12)
    main.pack(fill="both", expand=True)

    # ── Access Token ──
    token_var = tk.StringVar(value=first_non_empty(os.getenv("IG_ACCESS_TOKEN"), os.getenv("ACCESS_TOKEN")) or "")
    ttk.Label(main, text="Access Token").grid(row=0, column=0, sticky="w")
    ttk.Entry(main, textvariable=token_var, width=100).grid(row=1, column=0, columnspan=3, sticky="ew", pady=(0, 8))

    # ── Metric / IDs ──
    account_metric_var = tk.StringVar(value=ACCOUNT_METRICS[0])
    media_metric_var = tk.StringVar(value=MEDIA_METRICS[0])
    ig_user_var = tk.StringVar(value=os.getenv("IG_USER_ID", ""))
    media_var = tk.StringVar(value=os.getenv("IG_MEDIA_ID", ""))
    api_ver_var = tk.StringVar(value=default_api_version)

    ttk.Label(main, text="Account Metric  (use with IG User ID)").grid(row=2, column=0, sticky="w")
    ttk.Label(main, text="Media Metric  (use with Media ID)").grid(row=2, column=1, sticky="w", padx=(8, 0))
    ttk.Label(main, text="IG User ID").grid(row=2, column=2, sticky="w", padx=(8, 0))

    ttk.Combobox(main, textvariable=account_metric_var, values=ACCOUNT_METRICS, state="readonly", width=28).grid(
        row=3, column=0, sticky="w", pady=(0, 8)
    )
    ttk.Combobox(main, textvariable=media_metric_var, values=MEDIA_METRICS, state="readonly", width=28).grid(
        row=3, column=1, sticky="w", padx=(8, 0), pady=(0, 8)
    )
    ttk.Entry(main, textvariable=ig_user_var, width=26).grid(row=3, column=2, sticky="w", padx=(8, 0), pady=(0, 8))

    ttk.Label(main, text="Media ID (leave blank for account insights)").grid(row=4, column=0, sticky="w")
    ttk.Label(main, text="API Version").grid(row=4, column=2, sticky="w", padx=(8, 0))
    ttk.Entry(main, textvariable=media_var, width=40).grid(row=5, column=0, columnspan=2, sticky="w", pady=(0, 8))
    ttk.Entry(main, textvariable=api_ver_var, width=14).grid(row=5, column=2, sticky="w", padx=(8, 0), pady=(0, 8))

    # ── Optional Parameters ──
    opt_frame = ttk.LabelFrame(main, text="Optional Parameters", padding=8)
    opt_frame.grid(row=6, column=0, columnspan=3, sticky="ew", pady=(0, 8))

    metric_type_var = tk.StringVar(value="")
    period_var = tk.StringVar(value="")
    timeframe_var = tk.StringVar(value="")
    since_var = tk.StringVar(value="")
    until_var = tk.StringVar(value="")

    ttk.Label(opt_frame, text="metric_type").grid(row=0, column=0, sticky="w")
    ttk.Combobox(opt_frame, textvariable=metric_type_var, values=METRIC_TYPE_OPTIONS,
                 state="readonly", width=14).grid(row=1, column=0, sticky="w", pady=(0, 6))

    ttk.Label(opt_frame, text="period").grid(row=0, column=1, sticky="w", padx=(16, 0))
    ttk.Entry(opt_frame, textvariable=period_var, width=12).grid(row=1, column=1, sticky="w", padx=(16, 0), pady=(0, 6))

    ttk.Label(opt_frame, text="timeframe").grid(row=0, column=2, sticky="w", padx=(16, 0))
    ttk.Combobox(opt_frame, textvariable=timeframe_var, values=TIMEFRAME_OPTIONS,
                 state="readonly", width=16).grid(row=1, column=2, sticky="w", padx=(16, 0), pady=(0, 6))

    ttk.Label(opt_frame, text="since (YYYY-MM-DD)").grid(row=0, column=3, sticky="w", padx=(16, 0))
    ttk.Entry(opt_frame, textvariable=since_var, width=14).grid(row=1, column=3, sticky="w", padx=(16, 0), pady=(0, 6))

    ttk.Label(opt_frame, text="until (YYYY-MM-DD)").grid(row=0, column=4, sticky="w", padx=(16, 0))
    ttk.Entry(opt_frame, textvariable=until_var, width=14).grid(row=1, column=4, sticky="w", padx=(16, 0), pady=(0, 6))

    ttk.Label(opt_frame, text="breakdown").grid(row=2, column=0, columnspan=5, sticky="w", pady=(6, 2))
    breakdown_vars = {k: tk.BooleanVar() for k in BREAKDOWN_OPTIONS}
    bd_frame = ttk.Frame(opt_frame)
    bd_frame.grid(row=3, column=0, columnspan=5, sticky="w")
    for i, bd in enumerate(BREAKDOWN_OPTIONS):
        ttk.Checkbutton(bd_frame, text=bd, variable=breakdown_vars[bd]).grid(row=0, column=i, sticky="w", padx=(0, 10))

    # ── Output ──
    output = tk.Text(main, wrap="word", height=18)
    output.grid(row=8, column=0, columnspan=3, sticky="nsew", pady=(8, 0))
    scroll = ttk.Scrollbar(main, orient="vertical", command=output.yview)
    output.configure(yscrollcommand=scroll.set)
    scroll.grid(row=8, column=3, sticky="ns", pady=(8, 0))

    main.columnconfigure(0, weight=1)
    main.columnconfigure(1, weight=1)
    main.columnconfigure(2, weight=1)
    main.rowconfigure(8, weight=1)

    def write_output(text: str) -> None:
        output.delete("1.0", tk.END)
        output.insert(tk.END, text)

    def on_send() -> None:
        token = token_var.get().strip()
        ig_user_id = ig_user_var.get().strip() or None
        media_id = media_var.get().strip() or None
        api_version = api_ver_var.get().strip() or "v25.0"

        # Choose metric based on which endpoint will be used
        metric = (media_metric_var if media_id else account_metric_var).get().strip()

        metric_type = metric_type_var.get().strip()
        period = period_var.get().strip()
        timeframe = timeframe_var.get().strip()
        since = since_var.get().strip()
        until = until_var.get().strip()
        breakdown = ",".join(k for k, v in breakdown_vars.items() if v.get())

        if not token:
            write_output("Missing token. Please paste an access token.")
            return
        if not metric:
            write_output("Missing metric. Please choose a metric.")
            return

        try:
            endpoint = build_endpoint(api_version, media_id, ig_user_id)
        except ValueError as err:
            write_output(str(err))
            return

        params: Dict[str, str] = {"metric": metric, "access_token": token}
        if period:
            params["period"] = period
        if metric_type:
            params["metric_type"] = metric_type
        if timeframe:
            params["timeframe"] = timeframe
        if since:
            params["since"] = since
        if until:
            params["until"] = until
        if breakdown:
            params["breakdown"] = breakdown

        try:
            data = call_api(endpoint, params)
            payload_text = json.dumps(data, indent=2, ensure_ascii=False)
            write_output(f"URL: {hidden_url(endpoint, params)}\n\n{payload_text}")
        except HTTPError as err:
            body = err.read().decode("utf-8", errors="replace")
            write_output(f"HTTPError {err.code}: {err.reason}\n\n{body}")
        except URLError as err:
            write_output(f"URLError: {err.reason}")
        except json.JSONDecodeError as err:
            write_output(f"Failed to parse JSON response: {err}")

    ttk.Button(main, text="Send Request", command=on_send).grid(row=7, column=0, sticky="w")
    ttk.Button(main, text="Clear", command=lambda: write_output("")).grid(row=7, column=1, sticky="w")

    root.mainloop()
    return 0


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.gui or len(sys.argv) == 1:
        return launch_gui(args.api_version)
    return run_cli(args)


if __name__ == "__main__":
    sys.exit(main())
