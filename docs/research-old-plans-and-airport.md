# Old campus plans and airport data: what exists and where

Research notes, 15 October 2026. The question was whether 1950s and 1960s architecture or site plans of the campus (staff flats, buildings) exist, and what the Airports Authority of India (AAI) publishes about Pantnagar Airport.

## Short answer

| What | Exists? | Where | Online? |
| --- | --- | --- | --- |
| Original site plans of the university, 1950s | Yes | University of Illinois Archives, USA (paper) | No, scans on request |
| 1956 "Blueprint for a Rural University" and 1958 construction cost estimate | Yes | University of Illinois Archives | No, scans on request |
| 1969 campus planning report, 1966 campus soil survey and boring log | Yes | University of Illinois Archives | No, scans on request |
| Building drawings of staff quarters and other buildings | Almost certainly | GBPUAT Directorate of Works and Plants (Estate) | No, ask the university or file an RTI request |
| Airport runway, apron, navaids and surveyed obstacles | Yes | AAI eAIP (AD 2 VIPT) | Yes, downloaded to `data/raw/aai_vipt.json` |
| Airport expansion master plan (3,000 m runway) | Yes, prepared by AAI | AAI | No, not published |
| 1960s spy-satellite photos (CORONA, about 2 m) | Probably | USGS EarthExplorer | Yes, needs a free USGS login |

## 1. Airports Authority of India data (downloaded)

Source: AIP India, AD 2 VIPT, current edition AMDT 09/2026 (effective 1 Oct 2026), at <https://aim-india.aai.aero/eaip/eaip-v2-09-2026/index-en-GB.html> (menu: AD 2, VIPT/Pantnagar). Charts linked from AD 2.24: aerodrome chart `VIPT-ADC.pdf`, parking chart `VIPT-PDC.pdf` and obstacle charts `VIPT-AOCTA-RWY-10.pdf` and `VIPT-AOCTA-RWY-28.pdf` (AMDT 07/2023).

Saved as numbers in `data/raw/aai_vipt.json`:

- Airport reference point 29°01'55.73"N 79°28'20.89"E, elevation 772 ft (235.3 m).
- Runway 10/28, 1,372 m x 30 m, asphalt, thresholds surveyed to 0.01". Strip 1,492 x 150 m, end safety areas 90 x 60 m.
- Apron 90 x 94 m with 2 stands (ATR 72 and Q400), taxiway A 15 m wide, holding position.
- NDB "HW" and DME "PTN" positions, lit windsock.
- 124 surveyed obstacles with heights above sea level: trees, poles, boundary walls, a masjid, water tanks, the hangar, the beacon mast, two power pylons and the chimney of the Century Pulp and Paper Mill at Lalkuan.

The aerodrome chart also labels the terminal building, ATC, fire section, old MT office, staff quarter, met enclosure, signal square, cooling pit, the Amber Aviation hangar, nallahs and the boundary wall.

### What it says about the twin

- **Runway position:** the OpenStreetMap runway already in the twin is within about 4 m of AAI's surveyed thresholds (THR 10: 2.3 m N/S, 3.9 m E/W; THR 28: under 1 m).
- **Ground height:** the twin's ground at the thresholds and the reference point is within about 1 m of AAI's surveyed elevations (234.4 vs 233.4 m, 235.3 vs 234.4 m, 232.9 vs 233.3 m). This independently confirms the canopy-corrected terrain.
- **Tree heights:** for 55 surveyed tree groups that have a detected crown within 20 m, the canopy model is on average 5.4 m lower than AAI's figure (mean absolute difference 6.6 m). AAI records the top of the tallest tree in each group, so part of this is expected, but the canopy model probably underestimates the tallest trees.
- **Missing tall structures:** the paper-mill chimney (81 m above ground, 339.5 m above sea level) and two power pylons (29 m and 52 m) are inside the study window but not in the twin.

### Airport expansion (not in the eAIP)

- The Uttarakhand cabinet approved extending the runway from 1,372 m to 3,000 m in August 2023, needing about 804 acres ([Indian Infrastructure](https://indianinfrastructure.com/2023/08/24/pantnagar-airport-runway-expansion/)).
- 524.78 acres had been transferred to AAI by April 2025, mainly from Pantnagar University and the Tarai Development Corporation. AAI has prepared a master plan for the airport, but it is not public ([Indian Infrastructure](https://indianinfrastructure.com/2024/10/17/land-transferred-under-pantnagar-runway-expansion-project-in-uttarakhand/), [UNI](https://test.uniindia.com/uttarakhand-cm-meets-union-civil-aviation-minister-to-enhance-air-connectivity/north/news/3451202.html)).
- EPC works were bid out in May 2026, with PNC Infratech as the lowest bidder at Rs 302.44 crore over 24 months. The scope covers:
  - a new domestic terminal with parking and approach roads
  - the runway extension and strengthening
  - the apron, taxiways, isolation bay and runway end safety area (RESA)

  ([Investywise](https://www.investywise.com/?p=99137))

## 2. The original university plans (University of Illinois Archives)

The University of Illinois helped set up the university under contracts from 1959. Its archive catalogue (<https://archon.library.illinois.edu/archives/>) lists these folders. All are on paper and none are digitised.

| Series | Box | Folder |
| --- | --- | --- |
| 8/1/45, U.P. Agricultural University Publications Files | 1 | Committee on Rural University Plans, **Detailed site plans**, n.d. |
| 8/1/45 | 1 | Correspondence, transfer of Tarai State Farm to U.P.A.U., 1960-63 |
| 8/1/45 | 1 | W.V. Lambert, "History of U.P.A.U.", manuscript and master copy, ca. 1966 |
| 8/4/34, Harold W. Hannah Papers | 7 | Correspondence, India Blueprint: Rural University, 1955-59 |
| 8/4/34 | 7 | Blueprints for a Rural University, India, 1956 |
| 8/4/34 | 7 | Correspondence and reports, State Farm: Tarai, India, 1957 |
| 8/4/34 | 7 | Reports, booklets, photos, India, 1956 |
| 8/4/34 | 9 | **Estimate Construction Costs for Rudrapur University, 1958** |
| 8/4/34 | 9 | "A New University - the U.P.A.U." by Kap Stevenson, 1960; University Bulletin 1965-66 |
| 24/2/6, International Programs Reports File | 2 | Scheme of an Agricultural University at Rudrapur, n.d. |
| 24/2/6 | 4 | Lanford, Samuel T., **Campus Planning, 1969** (filed with the Uttar Pradesh reports) |
| 24/2/6 | 4 | Fehrenbacher and Ray, **Soil Survey, 1966** and **Log of Soil Borings, 1966** |
| 24/2/6 | 4-5 | Hannah: Suggested Blueprint for Rural University, 1956; The State Farm, Tarai, 1957 |
| 24/2/6 | 5 | UPAU Quarterly Reports, 1960-67 (8 folders); "UPAU, From An Open Field", n.d. |
| 8/1/44, International Programs File | 19 | "Institutional Transfer of Technology: The Land-Grant Model and the Agriculture University at Pantnagar" |

Box lists: `https://files.archon.library.illinois.edu/uasfa/0801045.pdf`, `0804034.pdf`, `2402006.pdf`, `0801044.pdf`.

There is also one digitised photograph, dated March 1960, captioned "Professor Hannah by Unfinished Uttar Pradesh Agricultural College" (archive ID 0010655; copyright holder unknown, so it is not used in the twin).

## 3. What the university itself publishes

- **House allotment rules:** the 1981 rules, amended to 2019, are at `gbpuat.ac.in/facility/estate_office/03.05.2019_GBPUAT_HAC_Rules.pdf`.
  - Residences come in categories I to V, from professors' houses (I) down to the smallest quarters (V).
  - Category V quarters were built near the hostels for cafeteria staff.
  - Outlying residential zones are Nagla, Beni, Haldi, Matkota and Patherchatta.
- **Estate office page:** it states that at least 300 new houses are planned (50 Category I, 100 Category II, 50 Category III and 100 for cafeteria staff).
- **Housing stock:** a 2011-12 government university compendium gives 2,250 staff quarters (450 for teaching staff and 1,800 for non-teaching staff) and 21 hostels.
- No campus map, master plan or building drawings are published online. They are held by the Directorate of Works and Plants (Estate).

## 4. Other historical sources (not yet accessed)

- **CORONA satellite photos, 1960-1972:**
  - These would show the campus as it was being built, at about 2 m resolution.
  - Search USGS EarthExplorer (<https://earthexplorer.usgs.gov/>), dataset "Declassified Data", around 29.02 N, 79.49 E.
  - Downloads need a free USGS account, which only the user can create.
- **US Army Map Service series U502, 1:250,000, 1950s:**
  - These show the Tarai before the university was built.
  - The area spans sheets NH 44-9, 44-10, 44-13 and 44-14.
  - The University of Texas map library (<https://maps.lib.utexas.edu/maps/ams/india/>) blocks automated access, so it has to be opened by hand.
- **HathiTrust:** search "Uttar Pradesh Agricultural University" at <https://catalog.hathitrust.org/> for early annual reports and bulletins. It is also behind a bot check.

## 5. Ready-to-send requests

### Email to the University of Illinois Archives (illiarch@illinois.edu)

> Subject: Reproduction request: Uttar Pradesh Agricultural University (Pantnagar) site plans
>
> Hello,
>
> I am building a non-commercial 3D model of the G.B. Pant University of Agriculture and Technology campus in Pantnagar, India (formerly Uttar Pradesh Agricultural University). Could you tell me the cost and process to obtain scans of the following?
>
> 1. Series 8/1/45, Box 1: "Committee on Rural University Plans, Detailed site plans, n.d."
> 2. Series 8/4/34 (Harold W. Hannah Papers), Box 7: "Blueprints for a Rural University, India, 1956", and Box 9: "Estimate Construction Costs for Rudrapur University, 1958"
> 3. Series 24/2/6, Box 4: "Lanford, Samuel T., Campus Planning, 1969" and "Fehrenbacher and Ray, Soil Survey, 1966 / Log of Soil Borings, 1966"
>
> Maps or drawings showing the campus layout, building positions or building types would be the most useful. Thank you.

### RTI request to GBPUAT (Public Information Officer, G.B. Pant University of Agriculture and Technology, Pantnagar 263145)

> Under the Right to Information Act 2005, please provide copies of:
>
> 1. The current campus layout or master plan of the main campus, Pantnagar, showing buildings, roads and residential colonies.
> 2. A list of university buildings and residential quarters with category (I to V), number of storeys and year of construction, as held by the Directorate of Works and Plants (Estate).
> 3. Type plans (architectural drawings) of the standard residential quarters of each category.
> 4. A map of the main campus boundary.

### RTI request to the Airports Authority of India (online at <https://rtionline.gov.in>, public authority: Airports Authority of India)

> Under the Right to Information Act 2005, please provide a copy of the approved Master Plan / layout plan of Pantnagar Airport (VIPT), including the proposed 3,000 m runway alignment, new terminal building and land boundary.
