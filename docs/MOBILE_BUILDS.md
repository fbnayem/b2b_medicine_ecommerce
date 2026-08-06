# Building the three mobile applications

`apps/mobile` produces **three separate applications** from one codebase:

| Application          | Who signs in                                             | Bundle identifier      | Icon background |
| -------------------- | -------------------------------------------------------- | ---------------------- | --------------- |
| **MedSupply Shop**   | Shop owners                                              | `com.medsupply.shop`   | green `#126b45` |
| **MedSupply Manage** | Super admins, admins, managers, storekeepers, sales reps | `com.medsupply.manage` | blue `#1f5fa8`  |
| **MedSupply Rider**  | Delivery riders                                          | `com.medsupply.rider`  | amber `#8a5300` |

Every role belongs to exactly one of them. `navigationRules.test.ts` fails if
that stops being true, because a role in none has an account that opens nothing
and a role in two makes "which one do I install?" unanswerable.

The three colours are from `chartLight` in `@medsupply/design-tokens`, which was
chosen to stay distinguishable in the common forms of colour blindness and in
greyscale. Three home-screen icons that share a foreground have to be told apart
by that one field.

## What differs between them, and what does not

**Differs:** the name, the URL scheme, the bundle identifier, the icon
background, the notification accent, the permissions asked of the operating
system, and which roles may sign in.

**Shared:** every screen, every shared package, the API they talk to, and the
whole of the permission model. All three are the same application wearing
different clothes, and the server decides what anybody may read or write from
their token exactly as it did when there was one.

### Permissions

Each application declares only what its own screens use, so nobody is asked for
a capability the product never exercises:

|        | Camera                         | Location                       |
| ------ | ------------------------------ | ------------------------------ |
| Shop   | —                              | —                              |
| Manage | barcode scanning while picking | —                              |
| Rider  | proof-of-delivery photographs  | where a delivery was confirmed |

Verify with `pnpm --filter @medsupply/mobile config:shop` — the resolved
`android.permissions` for the shop application is absent entirely.

`appVariant.test.ts` asserts this against the screens' own imports, so a screen
that starts using a camera fails the suite and somebody has to decide which
application is allowed to ask for one.

## Running one locally

```
pnpm --filter @medsupply/mobile start:shop      # or start:staff, start:rider
pnpm --filter @medsupply/mobile android:rider   # start and open on Android
pnpm --filter @medsupply/mobile ios:rider       # macOS only
pnpm --filter @medsupply/mobile config:rider    # print the resolved app config
```

`pnpm start` with no suffix is the staff application, because that is the build
wanted nine times in ten.

These go through `scripts/variant.mjs`, which sets `APP_VARIANT` and then runs
Expo's own CLI on this Node. `APP_VARIANT=rider expo start` is the usual way to
write that and **does not work on Windows**, which is where this is developed.

## First-time EAS setup

The three applications are **one EAS project** with three bundle identifiers,
which is the arrangement Expo's multiple-app-variants guide describes.
Credentials are keyed by bundle identifier, so one project holds all three sets.

1. `npm install -g eas-cli && eas login`
2. From `apps/mobile`, run `eas init`. Because the configuration is dynamic,
   EAS prints the project id rather than writing it to a file.
3. Put that id where `app.config.ts` reads it — as `EAS_PROJECT_ID` in the
   `base` profile's `env` in `eas.json`, or as an EAS project secret.
4. If the account is an organisation rather than a person, set `EAS_OWNER` the
   same way.

Nothing is committed with a placeholder project id. A wrong one builds under
somebody else's account; an absent one fails with a message that says so.

## Building

Nine profiles, three per stage:

```
eas build --profile development-rider --platform android
eas build --profile preview-shop      --platform android
eas build --profile production-staff  --platform all
```

- **development-\*** — a development client, internal distribution, `.apk` on
  Android and a simulator build on iOS. This is what you install to develop
  against; Expo Go cannot receive push notifications on Android.
- **preview-\*** — a real build against staging, internal distribution, `.apk`
  so it can be handed to a rider by link.
- **production-\*** — store distribution, `.aab` on Android, build numbers
  managed by EAS (`cli.appVersionSource: "remote"`, `autoIncrement: true`).

`appVariant.test.ts` asserts that a profile named `production-rider` actually
sets `APP_VARIANT=rider`, that only `production-*` profiles distribute to a
store, and that no production build points at `localhost`. Nine near-identical
JSON blocks are exactly where a copy-paste ships the shop application to the
riders' track.

### The API address is a placeholder

`eas.json` points preview and production at `medsupply.example`. **`.example` is
a reserved TLD that can never resolve**, so a build made before somebody sets
the real address fails loudly instead of quietly reaching a stranger's server.
Set `EXPO_PUBLIC_API_URL` per profile before the first real build.

## What you need, per platform

**Android** can be built here — either on EAS, or locally with
`npx expo prebuild` and Android Studio.

**iOS cannot be built on Windows.** It needs macOS with Xcode, or an EAS cloud
build, which runs on Apple hardware. Either way an Apple Developer account
($99/year) is required to get onto a device, TestFlight or the App Store.

## Before the first store submission

These are outstanding and are not code:

- **Three icons.** All three currently share `assets/icon.png` and are told
  apart only by the adaptive-icon background. That is enough to distinguish them
  on an Android home screen and **not** enough for a store listing.
- **Store listings**, screenshots and a privacy policy for each — written for
  that audience, which is the reason there are three applications at all.
- **A real API address**, per the note above.
- **`version`** is `1.0.0` for all three in `app.config.ts`. They will diverge;
  decide then whether they version together or apart.

## What the Shop build now carries (phase 37)

Nothing about the build changed, but what somebody installs did, and two points
matter for a store listing.

- **The Shop build registers a `register` route; the other two do not.** It is
  guarded in `app/_layout.tsx` by `APP_VARIANT === AppVariant.SHOP`, and the
  sign-in screen shows the link on the same condition. A rider or a storekeeper
  has an account created for them by an administrator, so offering them
  "register your pharmacy" would invite somebody to make an account nobody can
  use.
- **The Shop build still declares no camera and no location.** Everything added
  this phase — the quote, the addresses, the return form, the password change,
  registration — is HTTP and a keyboard. `pnpm --filter @medsupply/mobile
config:shop` still resolves `android.permissions` as absent, and
  `appVariant.test.ts` checks it against the screens' own imports rather than
  against the table, so a screen that later reaches for a camera fails the suite
  instead of the store review.
