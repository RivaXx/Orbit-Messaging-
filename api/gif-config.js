module.exports = function gifConfig(req, res) {
    res.setHeader('Cache-Control','no-store');
    if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed'});
    const candidate=process.env.ORBIT_GIPHY_PUBLIC_KEY || '';
    return res.status(200).json({key:/^[a-z0-9]{16,80}$/i.test(candidate) ? candidate : null});
};
