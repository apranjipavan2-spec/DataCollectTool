# Benchmarks library — sources

Curated baseline indicators for triangulating TableForge survey results against published secondary data. Indicator IDs are stable; values are point estimates from the cited round and should be re-validated against the latest publication before final reporting.

## Sources

- **Census of India 2011** — Office of the Registrar General & Census Commissioner. https://censusindia.gov.in/
- **NFHS-5 (2019-21)** — Ministry of Health & Family Welfare, IIPS Mumbai. https://rchiips.org/nfhs/
- **NSSO 77th Round** — Situation Assessment of Agricultural Households (SAS) + All India Debt & Investment Survey (AIDIS), MoSPI. https://www.mospi.gov.in/
- **PLFS 2022-23** — Periodic Labour Force Survey, MoSPI. https://www.mospi.gov.in/
- **CGWB Dynamic Ground Water Resources 2022** — Central Ground Water Board. https://cgwb.gov.in/
- **NITI Aayog SDG India Index 2023-24** — https://www.niti.gov.in/
- **PMKSY-PDMC 2023** — Pradhan Mantri Krishi Sinchayee Yojana / Per Drop More Crop, Department of Agriculture & Farmers Welfare.

## Schema

Each indicator carries:

```
indicator_id   string  unique, stable
name           string  human-readable label
source         string  citation (publication + round)
year           int     reference year
geography_level enum   national | state | district
geography_code string  ISO-like code (IN, KA, etc.)
geography_name string  display name
value          number  point estimate
unit           string  percent | hectares | ratio_per_1000 | index_0_100 ...
ci             [lo,hi] optional 95% CI on value
denominator    string  optional — what the % is computed over
topic          string  education | health | agriculture | ...
url            string  source URL
notes          string  caveats
```

## Adding indicators

1. Append a JSON object to `india_2024.json` → `indicators[]`.
2. Re-start backend (file is loaded once on router import; restart picks up edits).
3. Cite source + year + geography_level so users can verify.

## Caveats

- Values are **unweighted point estimates** from the cited round. They do not include the survey's design-based standard errors unless the source publication reports them.
- District-level indicators are missing from this seed — extend per programme need. Census 2011 district-level literacy and landholding are the most commonly requested.
- Year mismatches between user data and the benchmark are common — always show the benchmark year next to the comparison.
