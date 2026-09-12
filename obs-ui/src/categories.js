/* The object categories the searches dialog offers.

   This is the only curated list: the Go server and the astro backend
   are generic over object-type codes and validate only their shape, so
   widening what a user can search for is an edit to this file alone.
   The codes are SIMBAD object types; a search for one matches that
   type's subtypes too, which is why the broad entries (Star, Variable
   star, Galaxy) are worth offering next to the narrow ones.

   Every label here MUST match the one catalog.py gives the same code in
   _OTYPE_LABELS, so the category a user picked and the type a candidate
   comes back with read the same. */

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
    {group: 'Stars', code: 'pr*', label: 'Pre-main sequence star'},
    {group: 'Stars', code: 'YSO', label: 'Young stellar object'},
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
    {group: 'Double and multiple stars', code: 'SyS', label: 'Symbiotic star'},

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
    {group: 'Variable stars', code: 'Fl*', label: 'Flare star'},

    // Clusters
    {group: 'Clusters', code: 'Cl*', label: 'Star cluster'},
    {group: 'Clusters', code: 'GlC', label: 'Globular cluster'},
    {group: 'Clusters', code: 'OpC', label: 'Open cluster'},
    {group: 'Clusters', code: 'As*', label: 'Asterism'},
    {group: 'Clusters', code: 'MGr', label: 'Moving group'},

    // Nebulae and interstellar matter
    {group: 'Nebulae and interstellar matter', code: 'Neb', label: 'Nebula'},
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

const byCode = new Map(categories.map((c) => [c.code, c.label]));

/* The readable name of a category. Falls back to the code itself: a
   search saved with a code this list no longer offers must still
   summarise. */
export function categoryLabel(code) {
    return byCode.get(code) || code || "";
}
