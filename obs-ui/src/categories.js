/* The object categories the searches dialog offers.

   This is the only curated list: the Go server and the astro backend
   are generic over object-type codes and validate only their shape, so
   widening what a user can search for is an edit to this file alone.
   The codes are SIMBAD object types; a search for one matches that
   type's subtypes in SIMBAD's type hierarchy too, which is why the broad
   entries (Star, Variable star, Galaxy) are worth offering next to the
   narrow ones. The broad nebula entry is 'ISM', the root of SIMBAD's
   interstellar branch: its generic "Nebula" type ('GNe') is a leaf that
   the bright named nebulae, mostly HII regions, do not carry. SIMBAD
   retires codes now and then; a retired one goes into ALIASES below so
   a search saved with it keeps working, and the astro backend carries
   the same map (_OTYPE_ALIASES in catalog.py).

   Every label here MUST match the one catalog.py gives the same code in
   _OTYPE_LABELS, so the category a user picked and the type a candidate
   comes back with read the same. The sky view also finds a candidate's
   icon through that label, so a new category needs an entry in the
   ICONS table of icons.jsx as well (the module reports a code missing
   there in the console); open the app with "#icons" in the URL to
   check the icon next to the others. */

export const categories = [
    // Stars
    {group: 'Stars', code: '*', label: 'Star'},
    {group: 'Stars', code: 'MS*', label: 'Main sequence star'},
    {group: 'Stars', code: 'RG*', label: 'Red giant'},
    {group: 'Stars', code: 's*b', label: 'Blue supergiant'},
    {group: 'Stars', code: 's*r', label: 'Red supergiant'},
    {group: 'Stars', code: 's*y', label: 'Yellow supergiant'},
    {group: 'Stars', code: 'AB*', label: 'Asymptotic giant branch star'},
    {group: 'Stars', code: 'HB*', label: 'Horizontal branch star'},
    {group: 'Stars', code: 'WD*', label: 'White dwarf'},
    {group: 'Stars', code: 'BD*', label: 'Brown dwarf'},
    {group: 'Stars', code: 'HS*', label: 'Hot subdwarf'},
    {group: 'Stars', code: 'C*', label: 'Carbon star'},
    {group: 'Stars', code: 'S*', label: 'S star'},
    {group: 'Stars', code: 'Em*', label: 'Emission-line star'},
    {group: 'Stars', code: 'Be*', label: 'Be star'},
    {group: 'Stars', code: 'WR*', label: 'Wolf-Rayet star'},
    {group: 'Stars', code: 'TT*', label: 'T Tauri star'},
    {group: 'Stars', code: 'Y*O', label: 'Young stellar object'},
    {group: 'Stars', code: 'PM*', label: 'High proper-motion star'},
    {group: 'Stars', code: 'N*', label: 'Neutron star'},
    {group: 'Stars', code: 'Psr', label: 'Pulsar'},
    {group: 'Stars', code: 'BH', label: 'Black hole'},

    // Double and multiple stars
    {group: 'Double and multiple stars', code: '**', label: 'Double star'},
    {group: 'Double and multiple stars', code: 'EB*',
     label: 'Eclipsing binary'},
    {group: 'Double and multiple stars', code: 'SB*',
     label: 'Spectroscopic binary'},
    {group: 'Double and multiple stars', code: 'CV*',
     label: 'Cataclysmic variable star'},
    {group: 'Double and multiple stars', code: 'No*', label: 'Nova'},
    {group: 'Double and multiple stars', code: 'XB*', label: 'X-ray binary'},
    {group: 'Double and multiple stars', code: 'Sy*', label: 'Symbiotic star'},

    // Variable stars
    {group: 'Variable stars', code: 'V*', label: 'Variable star'},
    {group: 'Variable stars', code: 'Pu*', label: 'Pulsating variable'},
    {group: 'Variable stars', code: 'Ce*', label: 'Cepheid'},
    {group: 'Variable stars', code: 'RR*', label: 'RR Lyrae variable'},
    {group: 'Variable stars', code: 'Mi*', label: 'Mira variable'},
    {group: 'Variable stars', code: 'LP*', label: 'Long-period variable'},
    {group: 'Variable stars', code: 'dS*', label: 'Delta Scuti variable'},
    {group: 'Variable stars', code: 'bC*', label: 'Beta Cephei variable'},
    {group: 'Variable stars', code: 'RV*', label: 'RV Tauri variable'},
    {group: 'Variable stars', code: 'Ro*', label: 'Rotating variable'},
    {group: 'Variable stars', code: 'Er*', label: 'Eruptive variable'},

    // Clusters
    {group: 'Clusters', code: 'Cl*', label: 'Star cluster'},
    {group: 'Clusters', code: 'GlC', label: 'Globular cluster'},
    {group: 'Clusters', code: 'OpC', label: 'Open cluster'},
    {group: 'Clusters', code: 'As*', label: 'Asterism'},
    {group: 'Clusters', code: 'MGr', label: 'Moving group'},

    // Nebulae and interstellar matter
    {group: 'Nebulae and interstellar matter', code: 'ISM',
     label: 'Nebula or interstellar matter'},
    {group: 'Nebulae and interstellar matter', code: 'PN',
     label: 'Planetary nebula'},
    {group: 'Nebulae and interstellar matter', code: 'SNR',
     label: 'Supernova remnant'},
    {group: 'Nebulae and interstellar matter', code: 'HII',
     label: 'HII region'},
    {group: 'Nebulae and interstellar matter', code: 'RNe',
     label: 'Reflection nebula'},
    {group: 'Nebulae and interstellar matter', code: 'DNe',
     label: 'Dark nebula'},
    {group: 'Nebulae and interstellar matter', code: 'MoC',
     label: 'Molecular cloud'},
    {group: 'Nebulae and interstellar matter', code: 'SFR',
     label: 'Star-forming region'},

    // Galaxies and beyond
    {group: 'Galaxies and beyond', code: 'G', label: 'Galaxy'},
    {group: 'Galaxies and beyond', code: 'AGN', label: 'Active galaxy'},
    {group: 'Galaxies and beyond', code: 'QSO', label: 'Quasar'},
    {group: 'Galaxies and beyond', code: 'BLL', label: 'BL Lac object'},
    {group: 'Galaxies and beyond', code: 'rG', label: 'Radio galaxy'},
    {group: 'Galaxies and beyond', code: 'Sy1', label: 'Seyfert 1 galaxy'},
    {group: 'Galaxies and beyond', code: 'Sy2', label: 'Seyfert 2 galaxy'},
    {group: 'Galaxies and beyond', code: 'SBG', label: 'Starburst galaxy'},
    {group: 'Galaxies and beyond', code: 'LIN', label: 'LINER galaxy'},
    {group: 'Galaxies and beyond', code: 'EmG',
     label: 'Emission-line galaxy'},
    {group: 'Galaxies and beyond', code: 'LSB',
     label: 'Low surface brightness galaxy'},
    {group: 'Galaxies and beyond', code: 'IG', label: 'Interacting galaxies'},
    {group: 'Galaxies and beyond', code: 'PaG', label: 'Pair of galaxies'},
    {group: 'Galaxies and beyond', code: 'GrG', label: 'Group of galaxies'},
    {group: 'Galaxies and beyond', code: 'ClG', label: 'Cluster of galaxies'},
];

// The category a new search starts from: the nearest equivalent of the
// "Double stars" button this picker replaced.
export const DEFAULT_CATEGORY = '**';

// Codes SIMBAD has retired since the picker offered them, and what it
// offers instead (flare stars were folded into the eruptive variables).
export const ALIASES = {
    'Neb': 'ISM', 'YSO': 'Y*O', 'pr*': 'Y*O', 'SyS': 'Sy*', 'Fl*': 'Er*',
};

// A stored code as the picker offers it today.
export function currentCode(code) {
    return ALIASES[code] || code;
}

// antd Select options, grouped in the order the list is written in.
export const categoryOptions = categories.reduce((groups, c) => {
    const last = groups[groups.length - 1];
    const option = {value: c.code, label: c.label};
    if (last && last.label == c.group) {
	last.options.push(option);
    } else {
	groups.push({label: c.group, options: [option]});
    }
    return groups;
}, []);

const byCode = new Map(categories.map((c) => [c.code, c]));

/* The readable name of a category. Falls back to the code itself: a
   search saved with a code this list no longer offers must still
   summarise. */
export function categoryLabel(code) {
    const category = byCode.get(currentCode(code));
    return category ? category.label : (code || "");
}

// The picker group a category belongs to; undefined for a code it
// does not offer.
export function categoryGroup(code) {
    const category = byCode.get(currentCode(code));
    return category && category.group;
}
