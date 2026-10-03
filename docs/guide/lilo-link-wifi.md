---
id: "lilo-link-wifi"
title: "Set up Wi-Fi sending with Lilo Link"
summary: "Connect a Brother or Baby Lock machine to your Wi-Fi so Lilo can find it and send designs."
section: "sending"
order: 1
keywords: ["lilo link", "wifi", "wi-fi", "brother", "baby lock", "machine", "2.4 ghz", "network", "scan", "discover", "pair", "ip address", "saved machines", "local network"]
appContext: ["view.link", "link.machines", "link.settings"]
status: "ready"
---

# Set up Wi-Fi sending with Lilo Link

**Lilo Link** is the part of Lilo that talks to your sewing machine over Wi-Fi. It works with **Brother** and **Baby Lock** machines that have Wi-Fi built in. Other machines use a [USB stick](usb-stick.md).

## Before you start

- **Your machine must have Wi-Fi.** Look for a Wi-Fi symbol on the screen or the box.
- **Use a 2.4 GHz network.** Most embroidery machines cannot join a 5 GHz network. If your router has one name for both, connect the machine to the 2.4 GHz band. If you have two separate names, pick the one that ends in "2.4" or has no "5G".
- **Put your computer and your machine on the same network.** Not a guest network. Not a separate office Wi-Fi. If they are on different networks, Lilo cannot see the machine.

## Connect the machine

1. On the machine, open its **Wi-Fi settings** and join your 2.4 GHz network. Follow the machine's own manual for this part.
2. Check that the machine shows it is connected.

## Find it in Lilo

1. Open **Lilo Link** from the top of the window. Go to **Machines**.
2. Press **Scan network**. Lilo looks across your local network and lists what it finds under **Discovered on the network**.
3. Press **Save** next to your machine. It moves to **Saved machines**.
4. Press **Test** to check the connection.

Lilo detects the machine on its own. You do not need to type an address. If the scan finds nothing, you can type the machine's IP address under **Add machine manually**. The machine shows its IP address in its Wi-Fi or network screen.

## Mac: allow Local Network

The first time you scan, macOS asks to allow **Local Network** access. Choose **Allow**. If you said no by mistake, go to **System Settings, Privacy and Security, Local Network** and switch Lilo on.

## Windows and Linux: check the firewall

If scanning finds nothing and everything else is right, a firewall or security program may be blocking Lilo. Allow Lilo on your home (private) network.

## Next step

Read [Send a design](send-a-design.md). If something goes wrong, read [Wi-Fi troubleshooting](send-troubleshooting.md).
