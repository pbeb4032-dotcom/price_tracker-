# Iraq Trusted Core v1 Research

Verified on `2026-04-04` for the curated admin pack `iraq-trusted-core-v1`.

## Method

- Included only sources that showed strong current signals of being active Iraqi commerce sources for new products, large retailers, official brand stores, trusted marketplaces, or super apps with retail/grocery/pharmacy coverage.
- Excluded sources that were primarily classifieds, used-first, unclear, or could not be tied cleanly to a reliable official domain.
- Marked super apps and mixed commerce platforms as `mixed` and prepared them for section governance instead of forcing them into `new_only`.
- Left provinces empty when coverage could not be assigned cleanly without guessing. This avoids polluting the coverage dashboard with fake geography.

## Included Core Sources

- `iraq.talabat.com` - Talabat Iraq. Included as a strong mixed super-app source because Talabat operates in Iraq and supports grocery / pharmacy / retail-style flows. Governed as `mixed`, not `new_only`.
- `totersapp.com` - Toters. Included as a strong mixed source because the public site describes deliveries from local stores including grocery stores and similar retail partners.
- `lezzoo.com` - Lezzoo. Included as a strong mixed source because the official site explicitly lists groceries, pharmacy, and e-commerce.
- `gini.iq` - Gini / Souq Gini. Included as a mixed marketplace source. Explicitly governed to allow `Souq Gini` and block `Souq Aljumaa` style used/ambiguous sections.
- `simma.io` - Simma. Included as a strong e-commerce / marketplace source because the Iraq-localized site exposes stores and categories for branded shopping.
- `miswag.com` - Miswag. Included as a major Iraq e-commerce retailer.
- `orisdi.com` - Orisdi. Included as a strong online marketplace / retail source active in Iraq.
- `jum3a.com` - Jum3a. Included as a strong Iraq online shopping source with clear delivery and store structure.
- `bazzaar.com` - Bazzaar. Included as a trusted shopping destination and seller-enabled marketplace in Iraq.
- `ishtariiraq.com` - Ishtari Iraq. Included as an active Iraq online retailer with nationwide-delivery messaging.
- `toolmart.me` - Toolmart. Included as a trusted Iraq-focused procurement / tools commerce source.
- `ftp.elryan.com` - Elryan. Included because the live commerce site resolves here and clearly presents Iraq electronics / home / beauty retail.
- `alhafidh.com` - Alhafidh. Included as a major official Iraq appliances / electronics commerce source.
- `store.alnabaa.com` - Alnabaa Store. Included as a strong retailer candidate for electronics / appliances.
- `istyle.iq` - iStyle Iraq. Included as an official Apple-focused retail source in Iraq.
- `thebodyshop.iq` - The Body Shop Iraq. Included as an official beauty brand store for Iraq.
- `alshaheera.com` - Alshaheera. Included as a strong Iraq beauty / fragrance commerce source.
- `saharpharmacyonline.com` - Sahar Online Pharmacy. Included as a strong pharmacy / health commerce source for Iraq.
- `iraq.feel22.com` - feel22 Iraq. Included as an Iraq-localized beauty commerce source.

## Deferred / Not In Core Yet

- `real` - mentioned during research direction, but no clean official Iraqi commerce domain was verified strongly enough during this pass. It was deliberately excluded from the trusted core instead of guessing.
- `carrefour.iq` - strong brand, but this pass prioritized sources with cleaner live signals for the core pack. It can be added later in a secondary pack or watchlist after live adapter validation.
- `lcwaikiki.iq` - strong brand, but not included in the first trusted core because this pack is intentionally focused on cleaner initial rollout, not maximum source count.
- `iq.opensooq.com` and similar classifieds - intentionally excluded from trusted core because they are not aligned with the project's `new products only` rule.

## Source Pointers Used During Research

- https://iraq.talabat.com/ar
- https://www.totersapp.com/faq
- https://lezzoo.com/
- https://gini.iq/
- https://help.gini.iq/ar/article/thmyl-ttbyk-gny-tagr-1xt825t/
- https://www.simma.io/ar
- https://miswag.com/
- https://orisdi.com/
- https://jum3a.com/
- https://bazzaar.com/
- https://ishtariiraq.com/
- https://toolmart.me/
- https://ftp.elryan.com/en
- https://alhafidh.com/en/
- https://store.alnabaa.com
- https://istyle.iq/
- https://www.thebodyshop.iq/ar/pages/contact
- https://alshaheera.com/
- https://saharpharmacyonline.com/
- https://iraq.feel22.com/
