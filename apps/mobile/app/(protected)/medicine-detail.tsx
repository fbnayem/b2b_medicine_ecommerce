import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { AlternativeGroupKind, MedicineContentGroup, UserRole } from '@medsupply/shared-types';
import type { AlternativeGroup, Medicine } from '@medsupply/shared-types';
import { marginPercent } from '@medsupply/utilities';
import { apiClient, mediaUrl } from '../../src/api/client';
import {
  SAFETY_TONE,
  bodyPreview,
  contentLanguageFor,
  getMedicineContent,
  shownInFallback,
  type Monograph,
  type MonographSection,
} from '../../src/catalogue/content';
import { useCart } from '../../src/store/useCart';
import { useAuthStore } from '../../src/store/useAuth';
import { formatMoneyMinor } from '../../src/finance/money';
import { formatFinanceDate } from '../../src/finance/date';
import { useLanguage } from '../../src/i18n/useLanguage';
import {
  Badge,
  Button,
  Card,
  CardLink,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  SectionTitle,
  toast,
} from '../../src/components';
import { colour, layout } from '../../src/theme';

export default function MedicineDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, language } = useLanguage();
  const add = useCart((state) => state.add);
  const isOwner = useAuthStore((state) => state.user?.role) === UserRole.SHOP_OWNER;
  const [item, setItem] = useState<Medicine>();
  const [groups, setGroups] = useState<AlternativeGroup[]>([]);
  const [content, setContent] = useState<Monograph | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await apiClient.get(`/inventory/medicines/${id}`);
      setItem(response.data.data);
    } catch {
      setError(t('catalogue.couldNotLoadOne'));
    }
    /*
     * Separately, and allowed to fail quietly.
     *
     * "What else could you send" is worth having and is not worth an error
     * screen over the medicine somebody actually asked for — so a failure here
     * leaves the section absent rather than replacing the page with a retry
     * button for something nobody requested.
     */
    try {
      const response = await apiClient.get(`/inventory/medicines/${id}/alternatives`);
      setGroups(response.data.data ?? []);
    } catch {
      setGroups([]);
    }
    /*
     * The monograph rides the same quiet rule: supplementary reading, absent
     * rather than an error screen when it cannot be had — which includes a
     * rider, whom the server refuses this endpoint on purpose. Refetched when
     * the language switches, because the Bangla and English copies are
     * different documents. (`t` changes identity with the language, so the
     * dependency below re-runs this at exactly that moment.)
     */
    try {
      setContent(await getMedicineContent(id, contentLanguageFor(language)));
    } catch {
      setContent(null);
    }
  }, [id, t, language]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <Screen>
        {/* This was a red line of text with nothing to press. */}
        <ErrorState message={error} onRetry={() => void load()} />
      </Screen>
    );
  }

  if (!item) {
    return (
      <Screen>
        <LoadingState label={t('catalogue.loadingOne')} />
      </Screen>
    );
  }

  // The gallery, falling back to the single primary for anything entered by
  // hand before the catalogue could hold more than one.
  const gallery = item.productImages?.length
    ? item.productImages
    : [item.productImageUrl].filter((path): path is string => Boolean(path));

  /** What this shop earns on the pack — the same arithmetic the web card uses. */
  const margin = marginPercent(item.defaultSellingPriceMinor, item.mrpMinor);
  const marginOf = (other: Medicine) =>
    marginPercent(other.defaultSellingPriceMinor, other.mrpMinor);

  return (
    <Screen>
      <Text style={{ color: colour.brand, fontSize: layout.fontSize.sm }}>
        {item.reference} · {item.sku}
      </Text>
      <Text style={{ fontSize: layout.fontSize['2xl'], fontWeight: '700', color: colour.text }}>
        {item.brandName} {item.strength}
      </Text>
      <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.base }}>
        {item.genericName} · {item.dosageForm}
      </Text>

      {/*
        Every photograph, side by side and scrollable.

        A phone has no room for a thumbnail strip under a hero image, and a
        pharmacy comparing two packs wants to swipe rather than tap. Rendered
        only when there is more than one — a single card that scrolls nowhere
        looks broken.
      */}
      {gallery.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: layout.space[2] }}
          accessibilityLabel={t('catalogue.photos', { count: gallery.length })}
        >
          {gallery.map((path) => (
            <Image
              key={path}
              source={{ uri: mediaUrl(path) }}
              style={{
                width: 140,
                height: 140,
                borderRadius: layout.radius.lg,
                backgroundColor: colour.surface,
              }}
              resizeMode="contain"
              accessible={false}
            />
          ))}
        </ScrollView>
      ) : null}

      {/*
        The price, before the record.

        A pharmacy opens this screen to decide two things — is this the right
        pack, and what does it cost me — and the price used to be the last row
        of a seven-row list. The trade price leads; the MRP printed on the pack
        sits beside it struck through, and the gap between them is what the shop
        earns, so it is labelled as margin rather than dressed up as a discount
        we are giving.
      */}
      <Card>
        {/*
          The figure is labelled, and that is a rule rather than a preference:
          `customerMoney.test.ts` fails the build for a catalogue price rendered
          without `catalogue.listPrice` beside it. A bare number under a
          medicine reads as the price this shop pays, and it is the list price —
          theirs is settled by the server when they order.
        */}
        <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
          {t('catalogue.listPrice')}
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            flexWrap: 'wrap',
            gap: layout.space[2],
          }}
        >
          <Text style={{ fontSize: layout.fontSize.xl, fontWeight: '700', color: colour.text }}>
            {formatMoneyMinor(item.defaultSellingPriceMinor)}
          </Text>
          {item.mrpMinor !== undefined && item.mrpMinor > item.defaultSellingPriceMinor ? (
            <Text
              style={{
                color: colour.textMuted,
                textDecorationLine: 'line-through',
                fontSize: layout.fontSize.base,
              }}
            >
              {formatMoneyMinor(item.mrpMinor)}
            </Text>
          ) : null}
          {margin !== undefined && margin > 0 ? (
            <Badge tone="success">{t('catalogue.marginBadge', { percent: margin })}</Badge>
          ) : null}
        </View>
        <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
          {t('medicinePage.perUnit', { unit: item.unit })}
        </Text>
        <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
          {t('medicinePage.priceCaveat')}
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: layout.space[2],
            marginTop: layout.space[2],
          }}
        >
          <Badge tone={(item.totalAvailable ?? 0) > 0 ? 'success' : 'neutral'}>
            {(item.totalAvailable ?? 0) > 0
              ? t('alternatives.inStock', { count: item.totalAvailable ?? 0 })
              : t('alternatives.noStock')}
          </Badge>
          <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
            {item.packSize} {item.unit}
          </Text>
        </View>
      </Card>

      <Card>
        <SectionTitle>{t('catalogue.about')}</SectionTitle>
        <ListRow label={t('catalogue.manufacturer')} value={item.manufacturer} />
        <ListRow label={t('catalogue.packSize')} value={item.packSize} />
        <ListRow label={t('catalogue.category')} value={item.category} />
        {/*
          The catalogue, not the enum. This printed `PRESCRIPTION` in capitals
          at whoever opened it — the same defect the status wording rule exists
          to stop, on the screen a shop owner reads in Bangla.
        */}
        <ListRow
          label={t('catalogue.classification')}
          value={t(`classification.${item.classification}`)}
        />
        <ListRow
          label={t('catalogue.coldChain')}
          value={item.coldChain ? t('catalogue.yes') : t('catalogue.no')}
        />
        <ListRow
          label={t('catalogue.orderLimits')}
          value={`${item.minimumOrderQuantity}–${item.maximumOrderQuantity ?? t('catalogue.noMaximum')}`}
        />
      </Card>

      {item.description ? (
        <Text style={{ color: colour.text, lineHeight: 22 }}>{item.description}</Text>
      ) : null}

      {/*
        The supplier's monograph, in the order the service fixed: brief facts,
        prose, tips, the safety panel, then the merchandising copy — and the
        whole of it above the alternatives, so the safety panel is never buried
        below a promotion.

        The two lines around it carry more weight than their size suggests:
        `notAdvice` before the copy because a reader should know what they are
        holding *before* they act on it, and the fallback notice because a
        Bangla screen showing English must say so rather than present the
        stand-in as if nothing happened.
      */}
      {content ? (
        <>
          <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
            {t('catalogueContent.notAdvice')}
          </Text>
          {shownInFallback(content) ? (
            <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
              {t('catalogueContent.onlyInEnglish')}
            </Text>
          ) : null}
          {content.groups.map((group) => (
            <Card key={group.group}>
              <SectionTitle>{t(`catalogueContent.group.${group.group}`)}</SectionTitle>
              {group.group === MedicineContentGroup.QUICK_TIP
                ? // A list, because that is what the tips are: one sentence
                  // each, and a wall of merged sentences is how they arrived
                  // from the exporter.
                  group.sections.map((section, index) => (
                    <View key={index} style={{ flexDirection: 'row', gap: layout.space[2] }}>
                      <Text accessible={false} style={{ color: colour.textMuted, lineHeight: 22 }}>
                        •
                      </Text>
                      <Text style={{ flex: 1, color: colour.text, lineHeight: 22 }}>
                        {section.body}
                      </Text>
                    </View>
                  ))
                : group.sections.map((section, index) => (
                    <MonographPassage key={index} section={section} />
                  ))}
            </Card>
          ))}
          {/*
            Whose words these are, dated. The source *name* is deliberately not
            shown — it is an import identifier, not something a pharmacy has
            ever heard of — but the scrape date is: copy about a medicine ages,
            and an undated reprint reads as a fact about now.
          */}
          <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
            {t('catalogueContent.provenance')}
            {content.source?.scrapedAt ? ` · ${formatFinanceDate(content.source.scrapedAt)}` : ''}
          </Text>
        </>
      ) : null}

      {/*
        What else could be sent.

        Placed above the order button on purpose: a shop reading this because
        the thing is out of stock needs the alternative before they need the
        control they cannot use.
      */}
      {groups.map((group) => (
        <Card key={group.kind}>
          <SectionTitle>{t(`alternativeGroup.${group.kind}`)}</SectionTitle>
          {/*
            The supplier's advert, said out loud. On a prescription line this
            list holds products with no connection to the medicine at all, so
            the heading alone is not enough — the note is what stops a
            promotion reading as a suggestion of equivalence.
          */}
          {group.kind === AlternativeGroupKind.PROMOTED ? (
            <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
              {t('catalogueContent.promotedNote')}
            </Text>
          ) : null}
          {group.items.map((other) => (
            <CardLink
              key={other._id}
              accessibilityLabel={`${other.brandName} ${other.strength ?? ''}, ${
                other.totalAvailable > 0
                  ? t('alternatives.inStock', { count: other.totalAvailable })
                  : t('alternatives.noStock')
              }`}
              onPress={() => router.push(`/(protected)/medicine-detail?id=${other._id}`)}
            >
              <Text style={{ fontWeight: '600', color: colour.text }}>
                {other.brandName} {other.strength}
              </Text>
              {/*
                The molecule, then the maker. Two brands of the same drug are
                told apart by their manufacturer, and the row used to spend that
                line on the price instead — which now has a line of its own.
              */}
              {other.genericName ? (
                <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
                  {other.genericName}
                </Text>
              ) : null}
              <Text style={{ color: colour.textMuted, fontSize: layout.fontSize.sm }}>
                {other.manufacturer} · {other.packSize} {other.unit}
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'baseline',
                  flexWrap: 'wrap',
                  gap: layout.space[2],
                }}
              >
                <Text style={{ fontWeight: '700', color: colour.text }}>
                  {formatMoneyMinor(other.defaultSellingPriceMinor)}
                </Text>
                {other.mrpMinor !== undefined && other.mrpMinor > other.defaultSellingPriceMinor ? (
                  <Text
                    style={{
                      color: colour.textMuted,
                      textDecorationLine: 'line-through',
                      fontSize: layout.fontSize.sm,
                    }}
                  >
                    {formatMoneyMinor(other.mrpMinor)}
                  </Text>
                ) : null}
                {(() => {
                  // Bound once: `marginOf` is called twice otherwise, and the
                  // second call is what the compiler cannot see as defined.
                  const earns = marginOf(other);
                  return earns !== undefined && earns > 0 ? (
                    <Badge tone="success">{t('catalogue.marginBadge', { percent: earns })}</Badge>
                  ) : null;
                })()}
              </View>
              {/* The figure before the label, so a screen reader says the number first. */}
              <Badge tone={other.totalAvailable > 0 ? 'success' : 'neutral'}>
                {other.totalAvailable > 0
                  ? t('alternatives.inStock', { count: other.totalAvailable })
                  : t('alternatives.noStock')}
              </Badge>
            </CardLink>
          ))}
        </Card>
      ))}

      {/*
        This screen had no way to add anything. Reading about a medicine meant
        going back to the list and finding it again — which is the one thing
        somebody is certain to want after reading about it.
      */}
      {isOwner ? (
        <Button
          label={t('catalogue.addToOrder')}
          disabled={(item.totalAvailable ?? 0) === 0}
          onPress={() => {
            add(item);
            toast.success(t('cart.addedToOrder', { brand: item.brandName }));
            router.back();
          }}
        />
      ) : null}
    </Screen>
  );
}

/**
 * One monograph passage: its heading, its verdict if it is a safety row, and
 * its body folded behind "Show more" when it is long.
 *
 * A safety row's heading comes from the catalogue by its `type`, not from the
 * stored title — the supplier's title is English whichever language the copy is
 * in, and "Pregnancy" has a Bangla name of its own. The verdict badge carries
 * the verdict's *words*; its colour (`SAFETY_TONE`) is the second channel, so
 * the difference between safe and unsafe never rests on colour alone.
 */
function MonographPassage({ section }: { section: MonographSection }) {
  const { t } = useLanguage();
  const heading = section.safety?.type
    ? t(`catalogueContent.safetyType.${section.safety.type}`)
    : section.title;

  return (
    <View style={{ gap: layout.space[1] }}>
      {heading || section.safety?.tag ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: layout.space[2],
          }}
        >
          {heading ? (
            <Text style={{ fontWeight: '600', color: colour.text }}>{heading}</Text>
          ) : null}
          {section.safety?.tag ? (
            <Badge tone={SAFETY_TONE[section.safety.tag]}>
              {t(`catalogueContent.safetyTag.${section.safety.tag}`)}
            </Badge>
          ) : null}
        </View>
      ) : null}
      <MonographBody body={section.body} />
    </View>
  );
}

/**
 * A body folded behind "Show more" when it is long.
 *
 * Whether it is long — and where it folds — is `bodyPreview`'s decision in
 * `src/catalogue/content.ts`, not this component's: monograph passages run to
 * 29,431 characters, and a screen that showed forty of them whole would bury
 * the safety panel and the order button. A short body gets no control at all,
 * because a "Show more" that reveals nothing reads as broken.
 */
function MonographBody({ body }: { body: string }) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const preview = bodyPreview(body);

  if (!preview) {
    return <Text style={{ color: colour.text, lineHeight: 22 }}>{body}</Text>;
  }
  return (
    <View>
      <Text style={{ color: colour.text, lineHeight: 22 }}>{expanded ? body : preview}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => setExpanded((current) => !current)}
        style={{
          minHeight: layout.minTapTarget,
          justifyContent: 'center',
          alignSelf: 'flex-start',
        }}
      >
        <Text style={{ color: colour.brand, fontWeight: '600' }}>
          {expanded ? t('catalogueContent.showLess') : t('catalogueContent.showMore')}
        </Text>
      </Pressable>
    </View>
  );
}
