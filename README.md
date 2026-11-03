# Willowfield Sunday page

A single mobile page for the Sunday QR code: readings, sermon notes, notices, next steps, what's on and quick links. It's edited at `/admin` with one shared login.

## Updating each week

1. Go to `/admin` on the live site and sign in.
2. Under **This Sunday**, change the date and update each service: title, people, readings and sermon notes.
3. Update **Notices**, and check that **What's On** and the newsletter link are still current.
4. Tap **Preview** to check it, then **Publish**. The page updates in about a minute.

Type readings as plain references, such as `Matthew 8:23-27`. Each one links to that passage in the ESV on Bible Gateway. Past dated events hide themselves.

Unpublished changes are saved on your device, so you can come back to them. They aren't visible to anyone else until you publish.

Everything is stored in `this-week.txt`, which can still be edited by hand in GitHub if the admin page is ever unavailable.

## Going live

The admin page needs Cloudflare Pages, because `functions/api/content.js` runs there.

1. Put this folder in a GitHub repository. It can be private.
2. Connect that repository to Cloudflare Pages, with no build command and this folder as the output.
3. Add a custom domain such as `sunday.willowfieldchurch.co.uk`.

## Setting up the admin page

Until this is finished, nobody can sign in and nothing can be read or saved.

**1. Create a GitHub token**

Create a fine-grained personal access token limited to this one repository, with read and write access to Contents and nothing else. Set a reminder for its expiry date: when it expires, publishing stops working until it's replaced.

**2. Create the attempt limiter**

In the Cloudflare dashboard, create a Workers KV namespace. In the Pages project's settings, bind it under the name `LOGIN_ATTEMPTS`. Login is refused until this exists. It locks out a network address for 15 minutes after 10 wrong attempts.

**3. Create a session secret**

This signs logins so they can't be forged. Generate one and paste it into step 4. It doesn't need to be kept anywhere else:

```bash
openssl rand -base64 32
```

**4. Add the settings in Cloudflare**

In the Pages project, go to Settings > Variables and Secrets, add these for Production, then redeploy. Save the username, password, session secret and token as encrypted secrets:

| Name | Value |
| --- | --- |
| `ADMIN_USERNAME` | the admin username |
| `ADMIN_PASSWORD` | the admin password |
| `SESSION_SECRET` | the text generated in step 3 |
| `GITHUB_REPO` | e.g. `willowfieldchurch/sunday-page` |
| `GITHUB_TOKEN` | the token from step 1 |
| `GITHUB_BRANCH` | only if your branch isn't called `main` |

Never put the password or token in this folder, in `this-week.txt` or in GitHub.

**5. Check it before anyone relies on it**

- In a private window, sign in to `/admin`, publish a small change and confirm it appears on the page.
- Try a wrong password. It should be refused.
- Run this without being signed in, using your own address. It must not return the contents of `this-week.txt`:

```bash
curl -i https://sunday.willowfieldchurch.co.uk/api/content
```

## Managing the login

Everyone who edits shares one username and password. Logins last 8 hours on each device.

To change the password, for example when someone stops helping with the page, update `ADMIN_PASSWORD` in Cloudflare and redeploy. That signs everyone out straight away.

Every publish is saved in GitHub, so any earlier version can be restored from the file's history there. With one shared login, the history can't show who made each change.

If two people publish at about the same time, the second person is warned and can load the other version or replace it.

## The QR code

Open `/qr.html` on the live site. It fills in the page address and gives you a printable card. The code only contains the address, so you print it once and it keeps working as the content changes each week. Choose the final address before you print.

## Previewing on your computer

The page has to be served rather than opened as a file:

```bash
python3 -m http.server 8173
```

Then visit http://localhost:8173 for the page and http://localhost:8173/admin/ for the form. On your computer, the form shows what would be published instead of publishing it.

## Things to replace

- Any service with the "Sample content" label has made-up readings and notes. Replace them and untick the label in `/admin`.
- The logo and photo load from the Squarespace site. If that site ever moves, put copies in this folder and update the addresses.
- Headings use Outfit and body text uses Figtree, as free stand-ins for Sofia Pro and Effra, which are licensed to the main site.
