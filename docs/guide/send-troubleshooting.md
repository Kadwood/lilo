---
id: "send-troubleshooting"
title: "Wi-Fi troubleshooting"
summary: "Every message Lilo Link can show when a send fails, what it means and what to do."
section: "sending"
order: 4
keywords: ["error", "failed", "troubleshoot", "wifi", "send", "unreachable", "timeout", "busy", "storage", "format", "pairing", "file exists", "ip", "not found", "unauthorized", "code"]
appContext: ["dialog.send", "link.machines", "link.send", "link.logs"]
status: "ready"
---

# Wi-Fi troubleshooting

When a send fails, Lilo shows a short message. Under the message is a **code**, a short word with an underscore. Find your code below.

First check the basics:

1. The machine is **on** and awake.
2. It is on a **2.4 GHz** network, the **same network** as your computer. Read [Set up Wi-Fi sending](lilo-link-wifi.md).
3. Nothing else is sending to it.

## Codes

### `machine_unreachable`
"Machine unreachable." Lilo cannot connect at all. The machine is off, asleep, on a different network or has a new address. **Do this:** turn the machine on, check its Wi-Fi, press **Scan network** again.

### `machine_timeout`
"Request to machine timed out." The machine did not answer in time. **Do this:** wake the machine, move closer to the router and try again.

### `device_busy`
"The machine is busy with another transfer." Another send is in progress. **Do this:** wait a minute, or restart the machine.

### `delivery_unknown`
"Delivery could not be confirmed. Check the file on the device before sending again." The file may have arrived, but the machine did not confirm. **Do this:** look in the machine's file list before you send again. Sending twice could make a copy.

### `identity_changed`
"The device identity changed. Scan again and select the intended machine." The address now belongs to a different device. **Do this:** scan again and save the right machine.

### `unsupported_operation`
"This device does not support that operation." The machine cannot do what Lilo asked, like listing storage. **Do this:** use another way, such as a [USB stick](usb-stick.md).

### `file_exists`
"A file with this name exists. Confirm replacement before sending." **Do this:** rename the project, or confirm the replacement.

### `protocol_error`
"Protocol error." The machine answered in a way Lilo did not expect. **Do this:** update Lilo and the machine's software, then try again. If it keeps happening, [report a bug](bug-reports.md).

### `machine_rejected`
"Machine rejected the request (machine error code N)." The machine understood and said no. **Do this:** read the number on the machine's screen. Check its manual. Often the file is too complex or the machine is in a mode that does not accept designs.

### `file_too_large`
"Design is N bytes but the machine accepts at most N bytes." **Do this:** make the design smaller or use fewer stitches. Choose **Standard** quality. Read [Standard or Premium](standard-vs-premium.md).

### `insufficient_storage`
"Not enough free memory on the machine." **Do this:** delete old designs from the machine's memory.

### `unsupported_format`
"Unsupported design format; this machine accepts ..." **Do this:** export a format the machine accepts. Read [File formats](formats-reference.md).

### `upload_failed`
"Upload rejected with HTTP status N." The upload was refused part-way. **Do this:** try again. If it repeats, restart the machine and Lilo.

### `pairing_required`
"Machine requires pairing." The machine wants to approve this computer first. A hint says what to press on the machine. **Do this:** follow the hint on the machine's screen, then send again.

### `invalid_ip`
"Is not an IP address." The address you typed is wrong. **Do this:** type four numbers separated by dots, like 192.168.1.50.

### `missing_ip`
An address is needed to test or send. **Do this:** choose a machine first.

### `missing_filename`
A file name is required. **Do this:** give your project a name in the top bar.

### `cancelled`
"Transfer cancelled." You (or something else) stopped the send. Send again if you want it.

### `updating`
"Bridge is updating." Lilo is installing an update. **Do this:** wait until it restarts.

### `unauthorized`
"Missing or invalid API token." The window and Lilo's built-in connection service lost touch. **Do this:** restart Lilo.

### `not_found`
The thing Lilo asked about (a saved machine or a transfer) does not exist any more. **Do this:** refresh the Machines list.

### `internal_error`
Something went wrong inside Lilo. **Do this:** open **Lilo Link**, then **Logs**, and [report a bug](bug-reports.md) with the log text.

## Less common codes

These come from Lilo's built-in connection service. You will rarely see them. Most need only a retry or a restart.

### `ip_not_local`
Lilo refuses to contact an address that is not on your home or office network. **Do this:** use the address shown on the machine's own network screen. It usually starts with 192.168 or 10.

### `discovery_running`
A network scan is already running. **Do this:** wait for it to finish.

### `queue_full`
The send queue is full. **Do this:** wait for the current sends to finish, then try again.

### `previous_delivery_unknown`
An earlier send to this machine was never confirmed. **Do this:** check the machine's file list, resolve that send first, then send again.

### `not_cancellable`
Only a send that is queued or waiting can be cancelled. **Do this:** wait for it to end.

### `not_uncertain`
This send does not need a confirmation. **Do this:** nothing. Refresh the Logs page.

### `empty_body`
The file to send was empty. **Do this:** export the design again and check it has stitches.

### `invalid_filename`
The file name has a folder or odd characters in it. **Do this:** rename the project with letters and numbers only.

### `confirmation_required`
Deleting a file from a machine needs your confirmation. **Do this:** confirm in Lilo Link.

### `identity_required`
Lilo must read the machine's status before it deletes a file. **Do this:** press **Test** on the machine first.

### `pairing_in_progress`
Another pairing request is waiting for a decision. **Do this:** wait a moment and try again.

### `pairing_origin_mismatch`
A pairing request belongs to a different source. **Do this:** start the pairing again from Lilo.

### `origin_required`
Pairing only works from a web page. **Do this:** read the token in Lilo Link, **Settings**.

### `origin_not_allowed`
The web page asking to connect is not on the allowed list. **Do this:** only allow sites you trust.

### `invalid_origin`
A web address was not in the right shape. **Do this:** use a full address, like https://example.com.

## Still stuck?

[Use a USB stick](usb-stick.md) while you sort it out. Your design is safe.
