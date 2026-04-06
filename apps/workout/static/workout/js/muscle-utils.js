export function muscleNameToSvgId(muscleName) {
    let svgId = muscleName.toLowerCase().trim();

    if (svgId === 'lower back') {
        return 'lowerback';
    } else if (svgId === 'traps middle') {
        return 'traps-middle';
    } else if (svgId === 'rear shoulder') {
        return 'rear-shoulders';
    } else if (svgId === 'front shoulders') {
        return 'front-shoulders';
    } else if (svgId === 'hamstring') {
        return 'hamstrings';
    }

    return svgId;
}
